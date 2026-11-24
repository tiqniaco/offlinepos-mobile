/**
 * Phone + password login for the owner account.
 *  - login: generic "invalid_credentials" (never says whether the phone exists or has a password); 5 failures → 15 min
 *    lock, doubling. Attempts are claimed atomically before PBKDF2; per-IP / per-phone hourly caps on top.
 *  - set: allowed right after an SMS code (the OTP login opens a 10-minute window on that session) or with the
 *    current password. Every change signs out all OTHER sessions (lost / stolen phone after a reset).
 */
import type { Hono } from 'hono';
import { bytesToHex, normalizePhone, passwordLoginSchema, passwordProblem, passwordSetSchema } from '@daftarak/shared';
import type { AppEnv } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { pbkdf2Hex, safeEqual, PBKDF2_ITERATIONS } from '../lib/crypto';
import { createSession, requireSession } from '../auth/tokens';
import { bumpCounter } from '../otp/service';
import type { Deps } from './v1';

const FREE_FAILS = 5;
const lockMs = (failed: number) => Math.min(15 * 60_000 * 2 ** Math.max(0, failed - FREE_FAILS), 24 * 3_600_000);

interface AccRow {
  id: string;
  phone: string;
  password_hash: string | null;
  password_salt: string | null;
  password_iters: number | null;
  password_failed: number;
  password_locked_until: number | null;
}

async function check(acc: AccRow, password: string) {
  if (!acc.password_hash || !acc.password_salt) return false;
  return safeEqual(await pbkdf2Hex(password, acc.password_salt, acc.password_iters ?? PBKDF2_ITERATIONS), acc.password_hash);
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Password attempts per IP / per phone per hour (on top of the per-account lock). */
export const PASSWORD_PER_IP_HOUR = 30;
export const PASSWORD_PER_PHONE_HOUR = 20;
const lockedError = (until: number, now: number) => new ApiError(429, 'password_locked', String(Math.ceil((until - now) / 1000)));

/**
 * Claims one password attempt atomically BEFORE the (slow) PBKDF2 check: password_failed is bumped and, from the
 * FREE_FAILS-th attempt on, a provisional lock is written in the same statement, so parallel guesses cannot get past
 * the limit. Returns null when the account has no password; throws password_locked when it is locked.
 */
async function claimAttempt(env: AppEnv['Bindings'], where: { phone: string } | { id: string }, now: number): Promise<AccRow | null> {
  const [col, val] = 'phone' in where ? ['phone', where.phone] : ['id', where.id];
  const row = await env.DB.prepare(
    `UPDATE accounts SET password_failed = password_failed + 1,
       password_locked_until = CASE WHEN password_failed + 1 >= ?3 THEN ?4 ELSE password_locked_until END
     WHERE ${col} = ?1 AND password_hash IS NOT NULL AND (password_locked_until IS NULL OR password_locked_until <= ?2)
     RETURNING id, phone, password_hash, password_salt, password_iters, password_failed, password_locked_until`,
  )
    .bind(val, now, FREE_FAILS, now + lockMs(FREE_FAILS))
    .first<AccRow>();
  if (row) return row;
  const acc = await env.DB.prepare(`SELECT password_hash, password_locked_until FROM accounts WHERE ${col} = ?1`).bind(val).first<{ password_hash: string | null; password_locked_until: number | null }>();
  if (acc?.password_hash && acc.password_locked_until && acc.password_locked_until > now) throw lockedError(acc.password_locked_until, now);
  return null;
}

/** After the check: success clears the counter; a failure sets the real (doubling) lock when due. */
async function settleAttempt(env: AppEnv['Bindings'], acc: AccRow, ok: boolean, now: number): Promise<number | null> {
  if (ok) {
    await env.DB.prepare(`UPDATE accounts SET password_failed = 0, password_locked_until = NULL WHERE id = ?1`).bind(acc.id).run();
    return null;
  }
  const failed = acc.password_failed; // already counted by claimAttempt
  if (failed < FREE_FAILS) return null;
  const until = now + lockMs(failed);
  await env.DB.prepare(`UPDATE accounts SET password_locked_until = MAX(COALESCE(password_locked_until, 0), ?2) WHERE id = ?1`).bind(acc.id, until).run();
  return until;
}

/**
 * Mirror of claimAttempt/settleAttempt for a phone with no password (unknown, or SMS-only): failures and the doubling
 * lock live in rate_counters ("pw-fail:<phone>" = failures, "pw-lock:<phone>" = locked-until ms), so the response
 * sequence (invalid_credentials ×4, then password_locked with the same remaining seconds) and the work done (one
 * PBKDF2 per unlocked attempt, none while locked) match an account that has a password. Kept for 30 days by the
 * rate_counters cleanup (window_start = the day the counter started).
 */
async function dummyAttempt(env: AppEnv['Bindings'], phone: string, password: string, now: number): Promise<void> {
  const lock = await env.DB.prepare(`SELECT count FROM rate_counters WHERE key = ?1 ORDER BY window_start DESC LIMIT 1`).bind(`pw-lock:${phone}`).first<{ count: number }>();
  if (lock && lock.count > now) throw lockedError(lock.count, now);
  const fail = await env.DB.prepare(`SELECT window_start FROM rate_counters WHERE key = ?1 ORDER BY window_start DESC LIMIT 1`).bind(`pw-fail:${phone}`).first<{ window_start: number }>();
  const ws = fail?.window_start ?? Math.floor(now / DAY) * DAY;
  const failed = (await env.DB.prepare(
    `INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(`pw-fail:${phone}`, ws)
    .first<{ count: number }>())!.count;
  await pbkdf2Hex(password, '00'.repeat(16));
  if (failed < FREE_FAILS) return;
  const until = now + lockMs(failed);
  await env.DB.prepare(
    `INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, ?3)
     ON CONFLICT (key, window_start) DO UPDATE SET count = MAX(count, ?3)`,
  )
    .bind(`pw-lock:${phone}`, ws, until)
    .run();
  throw lockedError(until, now);
}

export function addPasswordRoutes(app: Hono<AppEnv>, deps: Deps, businessesOf: (env: AppEnv['Bindings'], accountId: string) => Promise<unknown[]>) {
  app.post('/auth/password/login', async (c) => {
    const b = await body(c, passwordLoginSchema);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new ApiError(401, 'invalid_credentials');
    const now = deps.now();
    if ((await bumpCounter(c.env.DB, `pw-ip:${clientIp(c)}`, HOUR, now)) > PASSWORD_PER_IP_HOUR) throw new ApiError(429, 'rate_limited', 'too many attempts from this network');
    if ((await bumpCounter(c.env.DB, `pw-phone:${phone}`, HOUR, now)) > PASSWORD_PER_PHONE_HOUR) throw new ApiError(429, 'rate_limited', 'too many attempts for this number');
    const acc = await claimAttempt(c.env, { phone }, now);
    if (!acc) {
      // Unknown phone or an SMS-only account: same answers (lock included), same work, so neither is revealed.
      await dummyAttempt(c.env, phone, b.password, now);
      throw new ApiError(401, 'invalid_credentials');
    }
    const ok = await check(acc, b.password);
    const until = await settleAttempt(c.env, acc, ok, now);
    if (!ok) {
      if (until) throw lockedError(until, now);
      throw new ApiError(401, 'invalid_credentials');
    }
    await c.env.DB.prepare(`UPDATE accounts SET last_login_at = ?2 WHERE id = ?1`).bind(acc.id, now).run();
    const tokens = await createSession(c.env, { accountId: acc.id, device: b.device, ip: clientIp(c), now });
    return c.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      account: { id: acc.id, phone, hasPassword: true },
      businesses: await businessesOf(c.env, acc.id),
    });
  });

  app.post('/auth/password/set', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, passwordSetSchema);
    const problem = passwordProblem(b.password);
    if (problem) throw new ApiError(400, 'password_weak', problem);
    const acc = (await c.env.DB.prepare(`SELECT id, phone, password_hash, password_salt, password_iters, password_failed, password_locked_until FROM accounts WHERE id = ?1`)
      .bind(s.aid)
      .first<AccRow>())!;
    const win = await c.env.DB.prepare(`SELECT password_reset_until AS r FROM sessions WHERE id = ?1`).bind(s.sid).first<{ r: number | null }>();
    const fresh = (win?.r ?? 0) > now || (s.stepUpUntil ?? 0) > now;
    if (!fresh) {
      if (!b.currentPassword) throw new ApiError(403, 'step_up_required');
      // A password alone must not take over a shop that is in use on another phone: that needs an SMS step-up.
      const other = await c.env.DB.prepare(
        `SELECT 1 AS x FROM devices d JOIN businesses z ON z.id = d.business_id
         WHERE z.owner_account_id = ?1 AND d.deactivated_at IS NULL AND (d.session_id IS NULL OR d.session_id != ?2) LIMIT 1`,
      )
        .bind(acc.id, s.sid)
        .first();
      if (other) throw new ApiError(403, 'step_up_required');
      const claimed = await claimAttempt(c.env, { id: acc.id }, now);
      const ok = !!claimed && (await check(claimed, b.currentPassword));
      const until = claimed ? await settleAttempt(c.env, claimed, ok, now) : null;
      if (!ok) {
        if (until) throw lockedError(until, now);
        throw new ApiError(401, 'invalid_credentials');
      }
    }
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await pbkdf2Hex(b.password, salt);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE accounts SET password_hash = ?2, password_salt = ?3, password_iters = ?4, password_updated_at = ?5, password_failed = 0, password_locked_until = NULL WHERE id = ?1`,
      ).bind(acc.id, hash, salt, PBKDF2_ITERATIONS, now),
      // Sign out every other phone; this one stays signed in. The reset window is used up.
      c.env.DB.prepare(`UPDATE sessions SET revoked_at = ?3, revoke_reason = 'password_changed' WHERE account_id = ?1 AND id != ?2 AND revoked_at IS NULL AND device_business_id IS NULL`).bind(acc.id, s.sid, now),
      c.env.DB.prepare(`UPDATE sessions SET password_reset_until = NULL WHERE id = ?1`).bind(s.sid),
    ]);
    return c.json({ ok: true });
  });
}
