/**
 * Sessions: short-lived access tokens (15 min, HMAC) + rotating refresh tokens with reuse detection.
 * Refresh token format: "<sessionId>.<random>"; only SHA-256(random) is stored.
 */
import { TOKEN_POLICY, base64urlDecode, base64urlEncode, uuidv7, utf8Decode, utf8ToBytes, type DeviceInfo } from '@daftarak/shared';
import type { Env } from '../env';
import { ApiError } from '../lib/http';
import { hmacHex, randomToken, safeEqual, sha256HexAsync } from '../lib/crypto';

export interface AccessClaims {
  sid: string;
  aid: string;
  exp: number;
}

export async function signAccess(env: Env, claims: AccessClaims): Promise<string> {
  const body = base64urlEncode(utf8ToBytes(JSON.stringify(claims)));
  return `at1.${body}.${await hmacHex(env.ACCESS_TOKEN_SECRET, `at1.${body}`)}`;
}

export async function verifyAccess(env: Env, token: string, now: number): Promise<AccessClaims> {
  const [p, body, mac] = token.split('.');
  if (p !== 'at1' || !body || !mac) throw new ApiError(401, 'unauthorized');
  if (!safeEqual(await hmacHex(env.ACCESS_TOKEN_SECRET, `at1.${body}`), mac)) throw new ApiError(401, 'unauthorized');
  const claims = JSON.parse(utf8Decode(base64urlDecode(body))) as AccessClaims;
  if (claims.exp < now) throw new ApiError(401, 'unauthorized', 'access token expired');
  return claims;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
}

async function issueAccess(env: Env, sid: string, aid: string, now: number) {
  const accessExpiresAt = now + TOKEN_POLICY.accessTtlMs;
  return { accessToken: await signAccess(env, { sid, aid, exp: accessExpiresAt }), accessExpiresAt };
}

export async function createSession(
  env: Env,
  args: { accountId: string; device: DeviceInfo; ip: string; now: number },
): Promise<IssuedTokens & { sessionId: string }> {
  const sid = uuidv7(args.now);
  const secret = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (id, account_id, refresh_hash, created_at, last_used_at, expires_at, install_id, platform, model, app_version, ip)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(
      sid,
      args.accountId,
      await sha256HexAsync(secret),
      args.now,
      args.now + TOKEN_POLICY.refreshTtlMs,
      args.device.installId,
      args.device.platform,
      args.device.model ?? null,
      args.device.appVersion,
      args.ip,
    )
    .run();
  return { sessionId: sid, refreshToken: `${sid}.${secret}`, ...(await issueAccess(env, sid, args.accountId, args.now)) };
}

interface SessionRow {
  id: string;
  account_id: string;
  refresh_hash: string;
  prev_refresh_hash: string | null;
  expires_at: number;
  revoked_at: number | null;
}

/**
 * Rotate a refresh token. Presenting the PREVIOUS token again (reuse = likely theft) revokes the session.
 */
export async function rotateRefresh(env: Env, refreshToken: string, now: number): Promise<IssuedTokens & { sessionId: string; accountId: string }> {
  const dot = refreshToken.indexOf('.');
  if (dot < 0) throw new ApiError(401, 'unauthorized');
  const sid = refreshToken.slice(0, dot);
  const secretHash = await sha256HexAsync(refreshToken.slice(dot + 1));
  const s = await env.DB.prepare(`SELECT id, account_id, refresh_hash, prev_refresh_hash, expires_at, revoked_at FROM sessions WHERE id = ?1`)
    .bind(sid)
    .first<SessionRow>();
  if (!s) throw new ApiError(401, 'unauthorized');
  if (s.revoked_at) throw new ApiError(401, 'session_revoked');
  if (s.expires_at < now) throw new ApiError(401, 'unauthorized', 'session expired');
  if (!safeEqual(secretHash, s.refresh_hash)) {
    if (s.prev_refresh_hash && safeEqual(secretHash, s.prev_refresh_hash)) {
      await revokeSession(env, sid, 'refresh_reuse', now);
      throw new ApiError(401, 'session_revoked', 'refresh token reuse detected');
    }
    throw new ApiError(401, 'unauthorized');
  }
  const secret = randomToken();
  const res = await env.DB.prepare(
    `UPDATE sessions SET prev_refresh_hash = refresh_hash, refresh_hash = ?2, last_used_at = ?3, expires_at = ?4
     WHERE id = ?1 AND refresh_hash = ?5`,
  )
    .bind(sid, await sha256HexAsync(secret), now, now + TOKEN_POLICY.refreshTtlMs, s.refresh_hash)
    .run();
  if (res.meta.changes !== 1) throw new ApiError(401, 'unauthorized', 'concurrent refresh');
  return { sessionId: sid, accountId: s.account_id, refreshToken: `${sid}.${secret}`, ...(await issueAccess(env, sid, s.account_id, now)) };
}

export async function revokeSession(env: Env, sid: string, reason: string, now: number) {
  await env.DB.prepare(`UPDATE sessions SET revoked_at = ?2, revoke_reason = ?3 WHERE id = ?1 AND revoked_at IS NULL`).bind(sid, now, reason).run();
}

/** Loads and checks the session behind an access token (revocation takes effect immediately). */
export async function requireSession(env: Env, authHeader: string | undefined, now: number): Promise<AccessClaims & { stepUpUntil: number | null }> {
  if (!authHeader?.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized');
  const claims = await verifyAccess(env, authHeader.slice(7), now);
  const s = await env.DB.prepare(`SELECT revoked_at, step_up_until FROM sessions WHERE id = ?1`)
    .bind(claims.sid)
    .first<{ revoked_at: number | null; step_up_until: number | null }>();
  if (!s) throw new ApiError(401, 'unauthorized');
  if (s.revoked_at) throw new ApiError(401, 'session_revoked');
  return { ...claims, stepUpUntil: s.step_up_until };
}
