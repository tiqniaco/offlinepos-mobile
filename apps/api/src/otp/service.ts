/**
 * OTP rules (SPEC §6, PLAN.md §11.3): 6 digits, 5-min expiry, 5 attempts, 60 s resend cooldown,
 * per-phone hourly/daily caps, per-IP hourly cap, stored only as an HMAC, country allow-list (EG/SA).
 */
import { OTP_POLICY, uuidv7 } from '@daftarak/shared';
import type { Env } from '../env';
import { ApiError } from '../lib/http';
import { hmacHex, randomDigits, safeEqual } from '../lib/crypto';
import type { OtpProvider } from './providers';

type Purpose = 'login' | 'step_up';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function codeHash(env: Env, phone: string, purpose: Purpose, code: string) {
  return hmacHex(env.OTP_PEPPER, `${phone}|${purpose}|${code}`);
}

/** Fixed-window counter in D1. Returns the new count. */
export async function bumpCounter(db: D1Database, key: string, windowMs: number, now: number): Promise<number> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();
  return row!.count;
}

export async function requestOtp(
  env: Env,
  provider: OtpProvider,
  args: { phone: string; purpose: Purpose; ip: string; locale: 'ar' | 'en'; now: number },
): Promise<{ resendAfterMs: number; expiresInMs: number }> {
  const { phone, purpose, ip, now } = args;
  const db = env.DB;

  const last = await db
    .prepare(`SELECT created_at FROM otp_codes WHERE phone = ?1 ORDER BY created_at DESC LIMIT 1`)
    .bind(phone)
    .first<{ created_at: number }>();
  if (last && now - last.created_at < OTP_POLICY.resendCooldownMs) {
    throw new ApiError(429, 'otp_cooldown', 'wait before requesting another code', OTP_POLICY.resendCooldownMs - (now - last.created_at));
  }

  const counts = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN created_at > ?2 THEN 1 ELSE 0 END) AS hour,
         COUNT(*) AS day
       FROM otp_codes WHERE phone = ?1 AND created_at > ?3`,
    )
    .bind(phone, now - HOUR, now - DAY)
    .first<{ hour: number | null; day: number }>();
  if ((counts?.hour ?? 0) >= OTP_POLICY.maxPerPhonePerHour || (counts?.day ?? 0) >= OTP_POLICY.maxPerPhonePerDay) {
    throw new ApiError(429, 'otp_rate_limited', 'too many codes for this number');
  }

  const ipCount = await bumpCounter(db, `otp-ip:${ip}`, HOUR, now);
  if (ipCount > OTP_POLICY.maxPerIpPerHour) {
    throw new ApiError(429, 'otp_rate_limited', 'too many codes from this network');
  }

  const code = randomDigits(OTP_POLICY.digits);
  // Older unused codes for this phone/purpose become invalid: only the latest one is checked.
  await db
    .prepare(`UPDATE otp_codes SET consumed_at = ?3 WHERE phone = ?1 AND purpose = ?2 AND consumed_at IS NULL`)
    .bind(phone, purpose, now)
    .run();
  await db
    .prepare(
      `INSERT INTO otp_codes (id, phone, purpose, code_hash, attempts, created_at, expires_at, ip)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)`,
    )
    .bind(uuidv7(now), phone, purpose, await codeHash(env, phone, purpose, code), now, now + OTP_POLICY.ttlMs, ip)
    .run();

  const sent = await provider.send(phone, code, args.locale);
  if (!sent.ok) {
    console.error('otp send failed', sent.error);
    throw new ApiError(502, 'otp_send_failed', 'could not send the code');
  }
  return { resendAfterMs: OTP_POLICY.resendCooldownMs, expiresInMs: OTP_POLICY.ttlMs };
}

/** Verifies and consumes the latest code. Throws ApiError on any failure. */
export async function verifyOtp(env: Env, args: { phone: string; purpose: Purpose; code: string; now: number }): Promise<void> {
  const { phone, purpose, code, now } = args;
  const row = await env.DB.prepare(
    `SELECT id, code_hash, attempts, expires_at FROM otp_codes
     WHERE phone = ?1 AND purpose = ?2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(phone, purpose)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row) throw new ApiError(400, 'otp_invalid', 'no active code');
  if (row.attempts >= OTP_POLICY.maxAttempts) throw new ApiError(429, 'otp_too_many_attempts', 'request a new code');
  if (now > row.expires_at) throw new ApiError(400, 'otp_expired', 'code expired');

  const ok = safeEqual(await codeHash(env, phone, purpose, code), row.code_hash);
  if (!ok) {
    const attempts = row.attempts + 1;
    await env.DB.prepare(`UPDATE otp_codes SET attempts = ?2 WHERE id = ?1`).bind(row.id, attempts).run();
    if (attempts >= OTP_POLICY.maxAttempts) throw new ApiError(429, 'otp_too_many_attempts', 'request a new code');
    throw new ApiError(400, 'otp_invalid', 'wrong code');
  }
  // Consume atomically: only one concurrent verify can win.
  const res = await env.DB.prepare(`UPDATE otp_codes SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL`).bind(row.id, now).run();
  if (res.meta.changes !== 1) throw new ApiError(400, 'otp_invalid', 'code already used');
}
