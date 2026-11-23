/** Public API used by the mobile app (`/v1`). See docs/api.md for the reference. */
import { Hono } from 'hono';
import {
  TOKEN_POLICY,
  TRIAL_PLAN_CODE,
  DAY_MS,
  attachDeviceSchema,
  base64urlDecode,
  checkinSchema,
  createBusinessSchema,
  normalizePhone,
  otpRequestSchema,
  otpVerifySchema,
  uuidv7,
} from '@daftarak/shared';
import { z } from 'zod';
import type { AppEnv, Env } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { wrapSecret } from '../lib/crypto';
import { requestOtp, verifyOtp } from '../otp/service';
import { providerFor, type OtpProvider } from '../otp/providers';
import { createSession, requireSession, revokeSession, rotateRefresh } from '../auth/tokens';
import { buildLicence, getPlan, signAnchorReceipt, type BusinessRow, type DeviceRow } from '../licence/issue';
import { addPhase6Routes, commitBackup, setIntegrityChecker, startBackup } from './phase6';
import { blocks, verifyIntegrity, type IntegrityInput } from '../integrity/verify';

/** Verify (or just record) device integrity; throws only when policy says so. */
export async function checkIntegrity(env: Env, input: IntegrityInput | undefined, action: 'signup' | 'activate' | 'checkin', now: number, deviceId?: string) {
  const v = await verifyIntegrity(env, input, now);
  if (deviceId) await env.DB.prepare(`UPDATE devices SET integrity_status = ?2, integrity_reason = ?3, integrity_at = ?4 WHERE id = ?1`).bind(deviceId, v.status, v.reason ?? null, now).run();
  if (blocks(env, v, action)) throw new ApiError(403, 'integrity_failed');
  return v;
}

/** Injected in tests to control time and the OTP provider. */
export interface Deps {
  now: () => number;
  provider: (env: Env) => OtpProvider;
}
export const defaultDeps: Deps = { now: () => Date.now(), provider: providerFor };

function utcDay(now: number): number {
  const d = new Date(now);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Counts requests per business per day to verify the ≤ 5/day budget (SPEC rule 2). */
export async function countRequest(env: Env, businessId: string, now: number) {
  await env.DB.prepare(
    `INSERT INTO request_counters (business_id, day, count) VALUES (?1, ?2, 1)
     ON CONFLICT (business_id, day) DO UPDATE SET count = count + 1`,
  )
    .bind(businessId, utcDay(now))
    .run();
}

function deviceCode(seq: number): string {
  // 0 → A … 25 → Z, 26 → AA …
  let s = '';
  let n = seq;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

async function businessesOf(env: Env, accountId: string) {
  const r = await env.DB.prepare(`SELECT id, name, country, type FROM businesses WHERE owner_account_id = ?1 ORDER BY created_at`)
    .bind(accountId)
    .all<{ id: string; name: string; country: 'EG' | 'SA'; type: 'shop' | 'trading' }>();
  return r.results.map((b) => ({ ...b, role: 'owner' as const }));
}

/** Registers a new active device for the business; all previous devices are deactivated (one active device in v1). */
async function registerDevice(env: Env, business: BusinessRow, sessionId: string, device: z.infer<typeof attachDeviceSchema>['device'], now: number) {
  const seqRow = await env.DB.prepare(`UPDATE businesses SET next_device_seq = next_device_seq + 1 WHERE id = ?1 RETURNING next_device_seq`)
    .bind(business.id)
    .first<{ next_device_seq: number }>();
  const code = deviceCode(seqRow!.next_device_seq - 1);
  const id = uuidv7(now);
  await env.DB.batch([
    env.DB.prepare(`UPDATE devices SET deactivated_at = ?2 WHERE business_id = ?1 AND deactivated_at IS NULL`).bind(business.id, now),
    env.DB.prepare(
      `INSERT INTO devices (id, business_id, code, session_id, install_id, platform, model, app_version, activated_at, last_checkin_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    ).bind(id, business.id, code, sessionId, device.installId, device.platform, device.model ?? null, device.appVersion, now),
  ]);
  const dev: DeviceRow = { id, business_id: business.id, code, deactivated_at: null };
  return {
    businessId: business.id,
    deviceId: id,
    deviceCode: code,
    licence: await buildLicence(env, business, dev, now),
    serverTime: now,
  };
}

export function v1Routes(deps: Deps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.post('/auth/otp/request', async (c) => {
    const b = await body(c, otpRequestSchema);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new ApiError(400, 'invalid_phone', 'only Egyptian and Saudi mobile numbers are supported');
    const r = await requestOtp(c.env, deps.provider(c.env), { phone, purpose: 'login', ip: clientIp(c), locale: b.locale, now: deps.now() });
    return c.json({ phone, ...r });
  });

  app.post('/auth/otp/verify', async (c) => {
    const b = await body(c, otpVerifySchema);
    const phone = normalizePhone(b.phone);
    if (!phone) throw new ApiError(400, 'invalid_phone');
    const now = deps.now();
    await verifyOtp(c.env, { phone, purpose: 'login', code: b.code, now });
    const acc = await c.env.DB.prepare(
      `INSERT INTO accounts (id, phone, created_at, last_login_at) VALUES (?1, ?2, ?3, ?3)
       ON CONFLICT (phone) DO UPDATE SET last_login_at = ?3 RETURNING id`,
    )
      .bind(uuidv7(now), phone, now)
      .first<{ id: string }>();
    const tokens = await createSession(c.env, { accountId: acc!.id, device: b.device, ip: clientIp(c), now });
    return c.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: tokens.accessExpiresAt,
      account: { id: acc!.id, phone },
      businesses: await businessesOf(c.env, acc!.id),
    });
  });

  app.post('/auth/refresh', async (c) => {
    const b = await body(c, z.object({ refreshToken: z.string() }));
    const t = await rotateRefresh(c.env, b.refreshToken, deps.now());
    return c.json({ accessToken: t.accessToken, refreshToken: t.refreshToken, accessExpiresAt: t.accessExpiresAt });
  });

  app.post('/auth/logout', async (c) => {
    const s = await requireSession(c.env, c.req.header('Authorization'), deps.now());
    await revokeSession(c.env, s.sid, 'logout', deps.now());
    return c.json({ ok: true });
  });

  /** Step-up: a fresh OTP for sensitive actions (backup key release, restore — Phase 6). */
  app.post('/auth/step-up/request', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const acc = await c.env.DB.prepare(`SELECT phone FROM accounts WHERE id = ?1`).bind(s.aid).first<{ phone: string }>();
    const r = await requestOtp(c.env, deps.provider(c.env), { phone: acc!.phone, purpose: 'step_up', ip: clientIp(c), locale: 'ar', now });
    return c.json(r);
  });

  app.post('/auth/step-up/verify', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, z.object({ code: z.string().regex(/^\d{6}$/) }));
    const acc = await c.env.DB.prepare(`SELECT phone FROM accounts WHERE id = ?1`).bind(s.aid).first<{ phone: string }>();
    await verifyOtp(c.env, { phone: acc!.phone, purpose: 'step_up', code: b.code, now });
    const until = now + TOKEN_POLICY.stepUpTtlMs;
    await c.env.DB.prepare(`UPDATE sessions SET step_up_until = ?2 WHERE id = ?1`).bind(s.sid, until).run();
    return c.json({ stepUpUntil: until });
  });

  app.get('/sessions', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const r = await c.env.DB.prepare(
      `SELECT id, created_at, last_used_at, platform, model, app_version FROM sessions
       WHERE account_id = ?1 AND revoked_at IS NULL AND expires_at > ?2 ORDER BY last_used_at DESC`,
    )
      .bind(s.aid, now)
      .all();
    return c.json({ sessions: r.results.map((x) => ({ ...x, current: x.id === s.sid })) });
  });

  app.delete('/sessions/:id', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const res = await c.env.DB.prepare(`UPDATE sessions SET revoked_at = ?3, revoke_reason = 'remote' WHERE id = ?1 AND account_id = ?2 AND revoked_at IS NULL`)
      .bind(c.req.param('id'), s.aid, now)
      .run();
    if (res.meta.changes !== 1) throw new ApiError(404, 'not_found');
    return c.json({ ok: true });
  });

  /** Onboarding: create the business, start the trial, register this phone as device "A". */
  app.post('/businesses', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, createBusinessSchema);
    const verdict = await checkIntegrity(c.env, b.integrity, 'signup', now);
    if (base64urlDecode(b.backupKey).length !== 32) throw new ApiError(400, 'invalid_request', 'backup key must be 32 bytes');
    const trial = await getPlan(c.env, TRIAL_PLAN_CODE);
    const id = uuidv7(now);
    const business: BusinessRow = {
      id,
      owner_account_id: s.aid,
      name: b.name,
      country: b.country,
      type: b.type,
      vat_registered: b.vatRegistered ? 1 : 0,
      plan_code: trial.code,
      status: 'trial',
      plan_expires_at: now + trial.trial_days * DAY_MS,
      created_at: now,
      last_seen_at: now,
      app_version: b.device.appVersion,
    };
    await c.env.DB.prepare(
      `INSERT INTO businesses (id, owner_account_id, name, country, type, vat_registered, plan_code, status, plan_expires_at, backup_key_wrapped, created_at, last_seen_at, app_version)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)`,
    )
      .bind(
        id,
        s.aid,
        b.name,
        b.country,
        b.type,
        business.vat_registered,
        trial.code,
        'trial',
        business.plan_expires_at,
        await wrapSecret(base64urlDecode(b.backupKey), c.env.BACKUP_WRAP_KEY),
        now,
        b.device.appVersion,
      )
      .run();
    const registration = await registerDevice(c.env, business, s.sid, b.device, now);
    await c.env.DB.prepare(`UPDATE devices SET integrity_status = ?2, integrity_reason = ?3, integrity_at = ?4 WHERE id = ?1`).bind(registration.deviceId, verdict.status, verdict.reason ?? null, now).run();
    await countRequest(c.env, id, now);
    return c.json({ business: { id, name: b.name, country: b.country, type: b.type, role: 'owner' }, registration }, 201);
  });

  /**
   * Use an existing business on this phone. The previous phone is deactivated (one active device in v1).
   * Data moves only via backup/restore (Phase 6) — the app warns the owner before calling this.
   */
  app.post('/devices/attach', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, attachDeviceSchema);
    const business = await c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1 AND owner_account_id = ?2`)
      .bind(b.businessId, s.aid)
      .first<BusinessRow>();
    if (!business) throw new ApiError(404, 'not_found');
    const registration = await registerDevice(c.env, business, s.sid, b.device, now);
    await countRequest(c.env, business.id, now);
    return c.json({ business: { id: business.id, name: business.name, country: business.country, type: business.type, role: 'owner' }, registration });
  });

  /** The ONE daily call (PLAN.md D-02): refresh-token rotation + licence + anchor. */
  app.post('/checkin', async (c) => {
    const now = deps.now();
    const b = await body(c, checkinSchema);
    const t = await rotateRefresh(c.env, b.refreshToken, now);
    const device = await c.env.DB.prepare(
      `SELECT d.id, d.business_id, d.code, d.deactivated_at FROM devices d
       JOIN businesses bz ON bz.id = d.business_id
       WHERE d.id = ?1 AND bz.owner_account_id = ?2`,
    )
      .bind(b.deviceId, t.accountId)
      .first<DeviceRow>();
    if (!device) throw new ApiError(404, 'not_found', 'device not registered');
    const business = (await c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(device.business_id).first<BusinessRow>())!;

    let anchorReceipt = null;
    if (b.anchor && !device.deactivated_at) {
      await c.env.DB.prepare(
        `INSERT INTO anchors (id, business_id, device_id, chain_seq, chain_head, audit_seq, audit_head, server_time)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
        .bind(uuidv7(now), business.id, device.id, b.anchor.chainSeq, b.anchor.chainHead, b.anchor.auditSeq, b.anchor.auditHead, now)
        .run();
      const r = { deviceId: device.id, ...b.anchor, serverTime: now };
      anchorReceipt = { ...b.anchor, serverTime: now, sig: signAnchorReceipt(c.env, r) };
    }
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE devices SET last_checkin_at = ?2, app_version = ?3 WHERE id = ?1`).bind(device.id, now, b.appVersion),
      c.env.DB.prepare(`UPDATE businesses SET last_seen_at = ?2, app_version = ?3 WHERE id = ?1`).bind(business.id, now, b.appVersion),
    ]);
    if (b.integrity) await checkIntegrity(c.env, b.integrity, 'checkin', now, device.id);
    await countRequest(c.env, business.id, now);

    // Backups ride on the daily check-in (no extra request): commit yesterday's upload, hand out today's PUT URL.
    let backupCommitted: boolean | undefined;
    if (b.committedBackupId) backupCommitted = await commitBackup(c.env, b.committedBackupId, business.id, now).catch(() => false);
    const backupPut = b.backupMeta && !device.deactivated_at ? await startBackup(c.env, business.id, device.id, b.backupMeta, 'auto', now) : null;

    const notices: { kind: string; textAr: string; textEn: string }[] = [];
    if (Math.abs(b.deviceTime - now) > DAY_MS) {
      notices.push({ kind: 'clock', textAr: 'ساعة الموبايل مش مظبوطة، من فضلك اظبط التاريخ والوقت.', textEn: 'Your phone clock is wrong. Please fix date and time.' });
    }
    return c.json({
      licence: await buildLicence(c.env, business, device, now),
      serverTime: now,
      refreshToken: t.refreshToken,
      accessToken: t.accessToken,
      accessExpiresAt: t.accessExpiresAt,
      anchorReceipt,
      backupPut,
      backupCommitted,
      notices,
    });
  });

  setIntegrityChecker(checkIntegrity);
  addPhase6Routes(app, deps, registerDevice, countRequest);
  return app;
}
