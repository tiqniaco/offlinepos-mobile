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
  args: { accountId: string; device: DeviceInfo; ip: string; now: number; deviceBusinessId?: string },
): Promise<IssuedTokens & { sessionId: string }> {
  const sid = uuidv7(args.now);
  const secret = randomToken();
  await env.DB.prepare(
    `INSERT INTO sessions (id, account_id, refresh_hash, created_at, last_used_at, expires_at, install_id, platform, model, app_version, ip, device_business_id)
     VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
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
      args.deviceBusinessId ?? null,
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
  orphan_refresh_hash: string | null;
  current_used_at: number | null;
  refresh_history: string | null;
  install_id: string | null;
  expires_at: number;
  revoked_at: number | null;
  device_business_id: string | null;
}

/**
 * A lost response must not cost the shop its session: the token rotated away less than this long ago is accepted
 * ONCE more (the retry of a check-in whose answer never arrived). Older reuse is treated as theft.
 */
export const REFRESH_GRACE_MS = 2 * 60_000;
/** Older rotated-away token hashes kept per session to recognise (and punish) their reuse. */
const HISTORY_KEEP = 8;

export interface CheckedRefresh {
  sessionId: string;
  accountId: string;
  /** "current" = the live token; "grace" = the immediately-previous token inside the grace window. */
  kind: 'current' | 'grace';
  presentedHash: string;
  /** Set for a cashier phone's session (limited to the shop sync endpoints + check-in). */
  deviceBusinessId: string | null;
}

/**
 * Validate a refresh token WITHOUT rotating it (so a caller can do its work first and rotate last).
 *
 * Reuse rules (a stolen token must never let the thief keep a session while the owner is silently logged out):
 *  - the live token → accepted (and marked as used);
 *  - the previous token → accepted ONCE as a "grace" retry only when ALL hold: within REFRESH_GRACE_MS of the
 *    rotation, the live token has never been presented (the real client never got it: lost response), and the
 *    caller's install id (when it sends one) is the session's. The grace refresh supersedes the live token, whose
 *    hash is kept as the "orphan";
 *  - the orphan, the previous token outside those rules, or any older token → the whole session is revoked
 *    (refresh_reuse): if a thief raced the owner, both end up signed out and the owner logs in again with SMS.
 */
export async function checkRefresh(env: Env, refreshToken: string, now: number, installId?: string | null): Promise<CheckedRefresh> {
  const dot = refreshToken.indexOf('.');
  if (dot < 0) throw new ApiError(401, 'unauthorized');
  const sid = refreshToken.slice(0, dot);
  const secretHash = await sha256HexAsync(refreshToken.slice(dot + 1));
  const s = await env.DB.prepare(
    `SELECT id, account_id, refresh_hash, prev_refresh_hash, prev_rotated_at, prev_grace_used, orphan_refresh_hash, current_used_at, refresh_history, install_id, expires_at, revoked_at, device_business_id
     FROM sessions WHERE id = ?1`,
  )
    .bind(sid)
    .first<SessionRow>();
  if (!s) throw new ApiError(401, 'unauthorized');
  if (s.revoked_at) throw new ApiError(401, 'session_revoked');
  if (s.expires_at < now) throw new ApiError(401, 'unauthorized', 'session expired');
  const reuse = async (): Promise<never> => {
    await revokeSession(env, sid, 'refresh_reuse', now);
    throw new ApiError(401, 'session_revoked', 'refresh token reuse detected');
  };
  if (safeEqual(secretHash, s.refresh_hash)) {
    // Mark the live token as used: from now on its predecessor no longer gets the grace path.
    if (s.current_used_at == null) await env.DB.prepare(`UPDATE sessions SET current_used_at = ?2 WHERE id = ?1 AND refresh_hash = ?3 AND current_used_at IS NULL`).bind(sid, now, secretHash).run();
    return { sessionId: sid, accountId: s.account_id, kind: 'current', presentedHash: secretHash, deviceBusinessId: s.device_business_id };
  }
  if (s.orphan_refresh_hash && safeEqual(secretHash, s.orphan_refresh_hash)) return reuse();
  if (s.prev_refresh_hash && safeEqual(secretHash, s.prev_refresh_hash)) {
    const sameInstall = !installId || !s.install_id || installId === s.install_id;
    if (s.prev_rotated_at != null && now - s.prev_rotated_at <= REFRESH_GRACE_MS && !s.prev_grace_used && s.current_used_at == null && sameInstall) {
      return { sessionId: sid, accountId: s.account_id, kind: 'grace', presentedHash: secretHash, deviceBusinessId: s.device_business_id };
    }
    return reuse();
  }
  if ((s.refresh_history ?? '').split(' ').some((h) => h && safeEqual(secretHash, h))) return reuse();
  throw new ApiError(401, 'unauthorized');
}

/** Issue the new pair for a token accepted by checkRefresh (compare-and-set: concurrent use loses). */
export async function commitRefresh(env: Env, chk: CheckedRefresh, now: number): Promise<IssuedTokens & { sessionId: string; accountId: string }> {
  const secret = randomToken();
  const newHash = await sha256HexAsync(secret);
  const res =
    chk.kind === 'current'
      ? await env.DB.prepare(
          `UPDATE sessions SET
             refresh_history = substr(trim(COALESCE(prev_refresh_hash, '') || ' ' || COALESCE(orphan_refresh_hash, '') || ' ' || COALESCE(refresh_history, '')), 1, ?6),
             prev_refresh_hash = refresh_hash, refresh_hash = ?2, last_used_at = ?3, expires_at = ?4, prev_rotated_at = ?3, prev_grace_used = 0,
             orphan_refresh_hash = NULL, current_used_at = NULL
           WHERE id = ?1 AND refresh_hash = ?5 AND revoked_at IS NULL`,
        )
          .bind(chk.sessionId, newHash, now, now + TOKEN_POLICY.refreshTtlMs, chk.presentedHash, HISTORY_KEEP * 65 - 1)
          .run()
      : // Grace retry: the never-delivered live token is superseded and kept as the orphan (presenting it later = theft);
        // the previous token stays "previous" but cannot be used again.
        await env.DB.prepare(
          `UPDATE sessions SET orphan_refresh_hash = refresh_hash, refresh_hash = ?2, last_used_at = ?3, expires_at = ?4, prev_grace_used = 1, current_used_at = NULL
           WHERE id = ?1 AND prev_refresh_hash = ?5 AND prev_grace_used = 0 AND current_used_at IS NULL AND revoked_at IS NULL`,
        )
          .bind(chk.sessionId, newHash, now, now + TOKEN_POLICY.refreshTtlMs, chk.presentedHash)
          .run();
  if (res.meta.changes !== 1) {
    // Lost the race. If a grace refresh superseded the very token presented here, that token is now the orphan:
    // someone else holds the session → revoke it.
    const s = await env.DB.prepare(`SELECT orphan_refresh_hash FROM sessions WHERE id = ?1`).bind(chk.sessionId).first<{ orphan_refresh_hash: string | null }>();
    if (s?.orphan_refresh_hash && safeEqual(s.orphan_refresh_hash, chk.presentedHash)) {
      await revokeSession(env, chk.sessionId, 'refresh_reuse', now);
      throw new ApiError(401, 'session_revoked', 'refresh token reuse detected');
    }
    throw new ApiError(401, 'unauthorized', 'concurrent refresh');
  }
  return { sessionId: chk.sessionId, accountId: chk.accountId, refreshToken: `${chk.sessionId}.${secret}`, ...(await issueAccess(env, chk.sessionId, chk.accountId, now)) };
}

/**
 * Rotate a refresh token (see checkRefresh for the grace / reuse rules).
 */
export async function rotateRefresh(env: Env, refreshToken: string, now: number, installId?: string | null): Promise<IssuedTokens & { sessionId: string; accountId: string }> {
  return commitRefresh(env, await checkRefresh(env, refreshToken, now, installId), now);
}

export async function revokeSession(env: Env, sid: string, reason: string, now: number) {
  await env.DB.prepare(`UPDATE sessions SET revoked_at = ?2, revoke_reason = ?3 WHERE id = ?1 AND revoked_at IS NULL`).bind(sid, now, reason).run();
}

async function loadSession(env: Env, authHeader: string | undefined, now: number) {
  if (!authHeader?.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized');
  const claims = await verifyAccess(env, authHeader.slice(7), now);
  const s = await env.DB.prepare(`SELECT revoked_at, step_up_until, device_business_id FROM sessions WHERE id = ?1`)
    .bind(claims.sid)
    .first<{ revoked_at: number | null; step_up_until: number | null; device_business_id: string | null }>();
  if (!s) throw new ApiError(401, 'unauthorized');
  if (s.revoked_at) throw new ApiError(401, 'session_revoked');
  return { claims, s };
}

/**
 * The owner's session behind an access token (revocation takes effect immediately). A cashier phone's session is
 * refused here: it only reaches the shop sync endpoints (requireDeviceSession) and the check-in.
 */
export async function requireSession(env: Env, authHeader: string | undefined, now: number): Promise<AccessClaims & { stepUpUntil: number | null }> {
  const { claims, s } = await loadSession(env, authHeader, now);
  if (s.device_business_id) throw new ApiError(403, 'wrong_device_role');
  return { ...claims, stepUpUntil: s.step_up_until };
}

/** A cashier phone's session: bound to one shop. */
export async function requireDeviceSession(env: Env, authHeader: string | undefined, now: number): Promise<AccessClaims & { businessId: string }> {
  const { claims, s } = await loadSession(env, authHeader, now);
  if (!s.device_business_id) throw new ApiError(403, 'wrong_device_role');
  return { ...claims, businessId: s.device_business_id };
}
