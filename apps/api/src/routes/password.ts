/**
 * Phone + password login for the owner account.
 *  - login: generic "invalid_credentials" (never says whether the phone exists); 5 failures → 15 min lock, doubling.
 *  - set: allowed right after an SMS code (the OTP login opens a 10-minute window on that session) or with the
 *    current password. Every change signs out all OTHER sessions (lost / stolen phone after a reset).
 */
import type { Hono } from 'hono';
import { bytesToHex, normalizePhone, passwordLoginSchema, passwordProblem, passwordSetSchema } from '@daftarak/shared';
import type { AppEnv } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { pbkdf2Hex, safeEqual, PBKDF2_ITERATIONS } from '../lib/crypto';
import { createSession, requireSession } from '../auth/tokens';
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

export function addPasswordRoutes(app: Hono<AppEnv>, deps: Deps, businessesOf: (env: AppEnv['Bindings'], accountId: string) => Promise<unknown[]>) {
  app.post('/auth/password/login', async (c) => {
    const b = await body(c, passwordLoginSchema);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new ApiError(401, 'invalid_credentials');
    const now = deps.now();
    const acc = await c.env.DB.prepare(`SELECT id, phone, password_hash, password_salt, password_iters, password_failed, password_locked_until FROM accounts WHERE phone = ?1`)
      .bind(phone)
      .first<AccRow>();
    if (acc?.password_locked_until && acc.password_locked_until > now) {
      throw new ApiError(429, 'password_locked', String(Math.ceil((acc.password_locked_until - now) / 1000)));
    }
    if (!acc || !acc.password_hash) {
      // Same work as a real check so timing does not reveal which phones have accounts.
      await pbkdf2Hex(b.password, '00'.repeat(16));
      throw new ApiError(401, acc ? 'password_not_set' : 'invalid_credentials');
    }
    if (!(await check(acc, b.password))) {
      const failed = acc.password_failed + 1;
      const until = failed >= FREE_FAILS ? now + lockMs(failed) : null;
      await c.env.DB.prepare(`UPDATE accounts SET password_failed = ?2, password_locked_until = ?3 WHERE id = ?1`).bind(acc.id, failed, until).run();
      if (until) throw new ApiError(429, 'password_locked', String(Math.ceil((until - now) / 1000)));
      throw new ApiError(401, 'invalid_credentials');
    }
    await c.env.DB.prepare(`UPDATE accounts SET password_failed = 0, password_locked_until = NULL, last_login_at = ?2 WHERE id = ?1`).bind(acc.id, now).run();
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
      if (acc.password_locked_until && acc.password_locked_until > now) throw new ApiError(429, 'password_locked', String(Math.ceil((acc.password_locked_until - now) / 1000)));
      if (!(await check(acc, b.currentPassword))) {
        const failed = acc.password_failed + 1;
        await c.env.DB.prepare(`UPDATE accounts SET password_failed = ?2, password_locked_until = ?3 WHERE id = ?1`).bind(acc.id, failed, failed >= FREE_FAILS ? now + lockMs(failed) : null).run();
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
      c.env.DB.prepare(`UPDATE sessions SET revoked_at = ?3, revoke_reason = 'password_changed' WHERE account_id = ?1 AND id != ?2 AND revoked_at IS NULL`).bind(acc.id, s.sid, now),
      c.env.DB.prepare(`UPDATE sessions SET password_reset_until = NULL WHERE id = ?1`).bind(s.sid),
    ]);
    return c.json({ ok: true });
  });
}
