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

/** Reads a fixed-window counter without bumping it. */
async function readCounter(db: D1Database, key: string, windowMs: number, now: number): Promise<number> {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const row = await db.prepare(`SELECT count FROM rate_counters WHERE key = ?1 AND window_start = ?2`).bind(key, windowStart).first<{ count: number }>();
  return row?.count ?? 0;
}

async function unbumpCounter(db: D1Database, key: string, windowMs: number, now: number) {
  const windowStart = Math.floor(now / windowMs) * windowMs;
  await db.prepare(`UPDATE rate_counters SET count = MAX(count - 1, 0) WHERE key = ?1 AND window_start = ?2`).bind(key, windowStart).run();
}

/** True when this Worker runs in production (wrangler env "production" sets ENVIRONMENT). */
export const isProduction = (env: Pick<Env, 'ENVIRONMENT'>) => env.ENVIRONMENT === 'production';

/** Anti SMS-pumping caps (all SMS, every phone / purpose). */
export const OTP_DEFAULT_DAILY_CAP = 3000;
export const OTP_PREFIX_HOURLY_CAP = 100;
/** Verify limits: calls per phone per hour, calls per IP per hour, wrong codes per phone per day. */
export const OTP_VERIFY_PER_PHONE_HOUR = 10;
export const OTP_VERIFY_PER_IP_HOUR = 60;
export const OTP_WRONG_PER_PHONE_DAY = 20;

const positive = (v: string | undefined, dflt: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt;
};

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

  // Parallel requests for one phone: the row-based cooldown above is a read-then-write, so claim the
  // cooldown slot atomically too (only one request per phone per cooldown window gets past).
  const slotKey = `otp-slot:${phone}`;
  if ((await bumpCounter(db, slotKey, OTP_POLICY.resendCooldownMs, now)) > 1) {
    throw new ApiError(429, 'otp_cooldown', 'wait before requesting another code', OTP_POLICY.resendCooldownMs);
  }

  // SMS pumping: a number range (first 6 digits) and the whole service have caps.
  const prefixCount = await bumpCounter(db, `otp-prefix:${phone.slice(0, 6)}`, HOUR, now);
  if (prefixCount > positive(env.OTP_PREFIX_HOURLY_CAP, OTP_PREFIX_HOURLY_CAP)) {
    await unbumpCounter(db, slotKey, OTP_POLICY.resendCooldownMs, now);
    throw new ApiError(429, 'otp_rate_limited', 'too many codes for this number range, try later');
  }
  const globalCount = await bumpCounter(db, 'otp-global', DAY, now);
  if (globalCount > positive(env.OTP_DAILY_CAP, OTP_DEFAULT_DAILY_CAP)) {
    await unbumpCounter(db, slotKey, OTP_POLICY.resendCooldownMs, now);
    console.error('otp: global daily SMS cap reached');
    throw new ApiError(429, 'otp_rate_limited', 'codes are paused, try later');
  }

  // E2E only: a fixed code with the console provider. Never in production, whatever the vars say.
  const fixed = !isProduction(env) && env.OTP_PROVIDER === 'console' && env.OTP_FIXED_CODE ? env.OTP_FIXED_CODE : null;
  const code = fixed ?? randomDigits(OTP_POLICY.digits);
  // Older unused codes for this phone/purpose become invalid: only the latest one is checked.
  await db
    .prepare(`UPDATE otp_codes SET consumed_at = ?3 WHERE phone = ?1 AND purpose = ?2 AND consumed_at IS NULL`)
    .bind(phone, purpose, now)
    .run();
  const id = uuidv7(now);
  await db
    .prepare(
      `INSERT INTO otp_codes (id, phone, purpose, code_hash, attempts, created_at, expires_at, ip)
       VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7)`,
    )
    .bind(id, phone, purpose, await codeHash(env, phone, purpose, code), now, now + OTP_POLICY.ttlMs, ip)
    .run();

  const sent = await provider.send(phone, code, args.locale);
  // Keep the provider's reply for diagnostics (masked phone, no code). Best-effort.
  await db
    .prepare(`INSERT INTO otp_send_log (id, phone_masked, provider, ok, detail, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(uuidv7(now), `${phone.slice(0, 5)}****${phone.slice(-2)}`, provider.name, sent.ok ? 1 : 0, [sent.error ?? sent.providerRef ?? '', sent.detail ?? ''].filter(Boolean).join(' | ').slice(0, 300), now)
    .run()
    .catch(() => undefined);
  if (!sent.ok) {
    console.error('otp send failed', sent.error);
    // A failed send must not use up the user's per-phone quota / cooldown (it still counts globally and per IP).
    await db.prepare(`DELETE FROM otp_codes WHERE id = ?1`).bind(id).run();
    await unbumpCounter(db, slotKey, OTP_POLICY.resendCooldownMs, now);
    throw new ApiError(502, 'otp_send_failed', 'could not send the code');
  }
  return { resendAfterMs: OTP_POLICY.resendCooldownMs, expiresInMs: OTP_POLICY.ttlMs };
}

/**
 * Verifies and consumes the latest code. Throws ApiError on any failure.
 * Race-safe: an attempt is claimed atomically BEFORE the code is compared, so parallel guesses can never exceed
 * maxAttempts, and the code is consumed with a conditional UPDATE so it works only once.
 */
export async function verifyOtp(env: Env, args: { phone: string; purpose: Purpose; code: string; now: number; ip?: string }): Promise<void> {
  const { phone, purpose, code, now } = args;
  const db = env.DB;
  if ((await bumpCounter(db, `otp-verify-ip:${args.ip ?? 'unknown'}`, HOUR, now)) > OTP_VERIFY_PER_IP_HOUR) {
    throw new ApiError(429, 'otp_rate_limited', 'too many attempts from this network');
  }
  if ((await bumpCounter(db, `otp-verify:${phone}`, HOUR, now)) > OTP_VERIFY_PER_PHONE_HOUR) {
    throw new ApiError(429, 'otp_too_many_attempts', 'too many attempts, try again later');
  }
  const wrongKey = `otp-wrong:${phone}`;
  if ((await readCounter(db, wrongKey, DAY, now)) >= OTP_WRONG_PER_PHONE_DAY) {
    throw new ApiError(429, 'otp_too_many_attempts', 'too many wrong codes today');
  }

  const row = await db.prepare(
    `SELECT id, code_hash, attempts, expires_at FROM otp_codes
     WHERE phone = ?1 AND purpose = ?2 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(phone, purpose)
    .first<{ id: string; code_hash: string; attempts: number; expires_at: number }>();
  if (!row) throw new ApiError(400, 'otp_invalid', 'no active code');
  if (row.attempts >= OTP_POLICY.maxAttempts) throw new ApiError(429, 'otp_too_many_attempts', 'request a new code');
  if (now > row.expires_at) throw new ApiError(400, 'otp_expired', 'code expired');

  // Claim one attempt atomically before comparing.
  const claim = await db
    .prepare(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?1 AND consumed_at IS NULL AND attempts < ?2 RETURNING attempts`)
    .bind(row.id, OTP_POLICY.maxAttempts)
    .first<{ attempts: number }>();
  if (!claim) throw new ApiError(429, 'otp_too_many_attempts', 'request a new code');

  const ok = safeEqual(await codeHash(env, phone, purpose, code), row.code_hash);
  if (!ok) {
    const wrong = await bumpCounter(db, wrongKey, DAY, now);
    if (wrong >= OTP_WRONG_PER_PHONE_DAY) {
      // Daily cap: every open code of this phone stops working.
      await db.prepare(`UPDATE otp_codes SET consumed_at = ?2 WHERE phone = ?1 AND consumed_at IS NULL`).bind(phone, now).run();
      throw new ApiError(429, 'otp_too_many_attempts', 'too many wrong codes today');
    }
    if (claim.attempts >= OTP_POLICY.maxAttempts) throw new ApiError(429, 'otp_too_many_attempts', 'request a new code');
    throw new ApiError(400, 'otp_invalid', 'wrong code');
  }
  // Consume atomically: only one concurrent verify can win.
  const res = await db.prepare(`UPDATE otp_codes SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL`).bind(row.id, now).run();
  if (res.meta.changes !== 1) throw new ApiError(400, 'otp_invalid', 'code already used');
}
