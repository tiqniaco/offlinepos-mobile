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
  prev_rotated_at: number | null;
  prev_grace_used: number | null;
  expires_at: number;
  revoked_at: number | null;
}

/**
 * A lost response must not cost the shop its session: the token rotated away less than this long ago is accepted
 * ONCE more (the retry of a check-in whose answer never arrived). Older reuse is treated as theft.
 */
export const REFRESH_GRACE_MS = 2 * 60_000;

export interface CheckedRefresh {
  sessionId: string;
  accountId: string;
  /** "current" = the live token; "grace" = the immediately-previous token inside the grace window. */
  kind: 'current' | 'grace';
  presentedHash: string;
}

/**
 * Validate a refresh token WITHOUT rotating it (so a caller can do its work first and rotate last).
 * Presenting the previous token after the grace window (or a second time) revokes the session.
 */
export async function checkRefresh(env: Env, refreshToken: string, now: number): Promise<CheckedRefresh> {
  const dot = refreshToken.indexOf('.');
  if (dot < 0) throw new ApiError(401, 'unauthorized');
  const sid = refreshToken.slice(0, dot);
  const secretHash = await sha256HexAsync(refreshToken.slice(dot + 1));
  const s = await env.DB.prepare(`SELECT id, account_id, refresh_hash, prev_refresh_hash, prev_rotated_at, prev_grace_used, expires_at, revoked_at FROM sessions WHERE id = ?1`)
    .bind(sid)
    .first<SessionRow>();
  if (!s) throw new ApiError(401, 'unauthorized');
  if (s.revoked_at) throw new ApiError(401, 'session_revoked');
  if (s.expires_at < now) throw new ApiError(401, 'unauthorized', 'session expired');
  if (safeEqual(secretHash, s.refresh_hash)) return { sessionId: sid, accountId: s.account_id, kind: 'current', presentedHash: secretHash };
  if (s.prev_refresh_hash && safeEqual(secretHash, s.prev_refresh_hash)) {
    if (s.prev_rotated_at != null && now - s.prev_rotated_at <= REFRESH_GRACE_MS && !s.prev_grace_used) {
      return { sessionId: sid, accountId: s.account_id, kind: 'grace', presentedHash: secretHash };
    }
    await revokeSession(env, sid, 'refresh_reuse', now);
    throw new ApiError(401, 'session_revoked', 'refresh token reuse detected');
  }
  throw new ApiError(401, 'unauthorized');
}

/** Issue the new pair for a token accepted by checkRefresh (compare-and-set: concurrent use loses). */
export async function commitRefresh(env: Env, chk: CheckedRefresh, now: number): Promise<IssuedTokens & { sessionId: string; accountId: string }> {
  const secret = randomToken();
  const newHash = await sha256HexAsync(secret);
  const res =
    chk.kind === 'current'
      ? await env.DB.prepare(
          `UPDATE sessions SET prev_refresh_hash = refresh_hash, refresh_hash = ?2, last_used_at = ?3, expires_at = ?4, prev_rotated_at = ?3, prev_grace_used = 0
           WHERE id = ?1 AND refresh_hash = ?5 AND revoked_at IS NULL`,
        )
          .bind(chk.sessionId, newHash, now, now + TOKEN_POLICY.refreshTtlMs, chk.presentedHash)
          .run()
      : // Grace retry: the never-delivered token is replaced; the previous one stays "previous" but cannot be used again.
        await env.DB.prepare(
          `UPDATE sessions SET refresh_hash = ?2, last_used_at = ?3, expires_at = ?4, prev_grace_used = 1
           WHERE id = ?1 AND prev_refresh_hash = ?5 AND prev_grace_used = 0 AND revoked_at IS NULL`,
        )
          .bind(chk.sessionId, newHash, now, now + TOKEN_POLICY.refreshTtlMs, chk.presentedHash)
          .run();
  if (res.meta.changes !== 1) throw new ApiError(401, 'unauthorized', 'concurrent refresh');
  return { sessionId: chk.sessionId, accountId: chk.accountId, refreshToken: `${chk.sessionId}.${secret}`, ...(await issueAccess(env, chk.sessionId, chk.accountId, now)) };
}

/**
 * Rotate a refresh token. The previous token is accepted once within REFRESH_GRACE_MS (lost response);
 * presenting it later (reuse = likely theft) revokes the session.
 */
export async function rotateRefresh(env: Env, refreshToken: string, now: number): Promise<IssuedTokens & { sessionId: string; accountId: string }> {
  return commitRefresh(env, await checkRefresh(env, refreshToken, now), now);
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
