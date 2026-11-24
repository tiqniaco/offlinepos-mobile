/**
 * Super-admin API (`/admin`). Login = email + password + TOTP (all three required).
 * Bearer session token held in the admin SPA's sessionStorage; CORS limited to ADMIN_ORIGIN.
 * Every mutating action is written to admin_audit.
 */
import { announceSchema, effectiveStatusSql, targetSchema, targetSql, type Target } from '../announce/announce';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { DAY_MS, FEATURES, uuidv7, verifyTotp } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { pbkdf2Hex, randomToken, safeEqual, sha256HexAsync } from '../lib/crypto';
import type { Deps } from '../routes/v1';
import { defaultDeps } from '../routes/v1';
import { newActivationCode } from '../routes/phase6';
import { activationStatement, planActivation } from '../billing/activate';
import { receiptContentType } from '../billing/manual';
import { cairoMonthStart } from '../ocr/scan';
import { addUsageAdminRoutes, freeTierStatus } from './usage';
import { cairoDay, cairoDayMinus } from '../usage/meter';

const SESSION_TTL = 8 * 3_600_000;
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;

async function audit(env: Env, adminId: string, action: string, target: string | null, details: unknown, now: number) {
  await env.DB.prepare(`INSERT INTO admin_audit (id, admin_id, action, target, details_json, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(uuidv7(now), adminId, action, target, JSON.stringify(details ?? null), now)
    .run();
}

async function requireAdmin(c: Context<AppEnv>, now: number): Promise<string> {
  const h = c.req.header('Authorization');
  if (!h?.startsWith('Bearer ')) throw new ApiError(401, 'unauthorized');
  const [id, secret] = h.slice(7).split('.');
  if (!id || !secret) throw new ApiError(401, 'unauthorized');
  const s = await c.env.DB.prepare(
    `SELECT s.admin_id, s.token_hash, s.expires_at, s.revoked_at, u.disabled_at FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_id WHERE s.id = ?1`,
  )
    .bind(id)
    .first<{ admin_id: string; token_hash: string; expires_at: number; revoked_at: number | null; disabled_at: number | null }>();
  if (!s || s.revoked_at || s.disabled_at || s.expires_at < now) throw new ApiError(401, 'unauthorized');
  if (!safeEqual(await sha256HexAsync(secret), s.token_hash)) throw new ApiError(401, 'unauthorized');
  return s.admin_id;
}

const planSchema = z.object({
  nameAr: z.string().min(1).max(40),
  nameEn: z.string().min(1).max(40),
  monthlyEgp: z.number().int().min(0),
  monthlySar: z.number().int().min(0),
  yearlyEgp: z.number().int().min(0),
  yearlySar: z.number().int().min(0),
  limits: z.object({
    users: z.number().int().min(-1),
    products: z.number().int().min(-1),
    parties: z.number().int().min(-1),
    invoices_month: z.number().int().min(-1),
    backups_kept: z.number().int().min(-1),
    /** Invoice photo scans per month (0 = not in the plan). */
    ocr_month: z.number().int().min(-1).default(0),
    /** Usage limits (optional: a plan saved without them uses the plan's seed defaults on the server). */
    sms_day: z.number().int().min(-1).optional(),
    backup_storage_mb: z.number().int().min(-1).optional(),
    receipt_uploads_month: z.number().int().min(-1).optional(),
    api_requests_day: z.number().int().min(-1).optional(),
    devices: z.number().int().min(-1).optional(),
  }),
  features: z.array(z.enum(FEATURES)),
  trialDays: z.number().int().min(0).max(90),
  active: z.boolean(),
});

async function reach(env: Env, t: Target, now: number, withTokens = false) {
  const { where, args } = targetSql(t, now);
  const n = await env.DB.prepare(
    `SELECT COUNT(DISTINCT b.id) AS businesses, COUNT(d.id) AS devices, COUNT(d.push_token) AS push
     FROM businesses b LEFT JOIN devices d ON d.business_id = b.id AND d.deactivated_at IS NULL WHERE ${where}`,
  )
    .bind(...args)
    .first<{ businesses: number; devices: number; push: number }>();
  const tokens = withTokens
    ? (await env.DB.prepare(`SELECT DISTINCT d.push_token AS t FROM devices d JOIN businesses b ON b.id = d.business_id WHERE d.deactivated_at IS NULL AND d.push_token IS NOT NULL AND ${where}`).bind(...args).all<{ t: string }>()).results.map((r) => r.t)
    : [];
  return { businesses: n?.businesses ?? 0, devices: n?.devices ?? 0, push: n?.push ?? 0, tokens };
}

/** e.g. 23/12/2026 (Cairo time). */
function arDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

export function adminRoutes(deps: Deps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.post('/login', async (c) => {
    const now = deps.now();
    const b = await body(c, z.object({ email: z.string().email(), password: z.string().min(1), totp: z.string().regex(/^\d{6}$/) }));
    const u = await c.env.DB.prepare(`SELECT * FROM admin_users WHERE email = ?1`).bind(b.email.toLowerCase()).first<{
      id: string;
      password_hash: string;
      password_salt: string;
      totp_secret: string;
      totp_last_step: number;
      failed_logins: number;
      locked_until: number | null;
      disabled_at: number | null;
    }>();
    // Same generic error for every failure (no user enumeration).
    const fail = async () => {
      if (u) {
        const failed = u.failed_logins + 1;
        await c.env.DB.prepare(`UPDATE admin_users SET failed_logins = ?2, locked_until = ?3 WHERE id = ?1`)
          .bind(u.id, failed, failed >= MAX_FAILED ? now + LOCK_MS : null)
          .run();
      }
      return new ApiError(401, 'unauthorized', 'invalid credentials');
    };
    if (!u || u.disabled_at) throw await fail();
    if (u.locked_until && u.locked_until > now) throw new ApiError(429, 'forbidden', 'account temporarily locked', u.locked_until - now);
    if (!safeEqual(await pbkdf2Hex(b.password, u.password_salt), u.password_hash)) throw await fail();
    const step = verifyTotp(u.totp_secret, b.totp, now);
    if (step === null || step <= u.totp_last_step) throw await fail(); // also blocks TOTP replay
    const sid = uuidv7(now);
    const secret = randomToken();
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE admin_users SET failed_logins = 0, locked_until = NULL, totp_last_step = ?2 WHERE id = ?1`).bind(u.id, step),
      c.env.DB.prepare(`INSERT INTO admin_sessions (id, admin_id, token_hash, created_at, expires_at, ip) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(
        sid,
        u.id,
        await sha256HexAsync(secret),
        now,
        now + SESSION_TTL,
        clientIp(c),
      ),
    ]);
    await audit(c.env, u.id, 'login', null, { ip: clientIp(c) }, now);
    return c.json({ token: `${sid}.${secret}`, expiresAt: now + SESSION_TTL });
  });

  app.post('/logout', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const sid = c.req.header('Authorization')!.slice(7).split('.')[0]!;
    await c.env.DB.prepare(`UPDATE admin_sessions SET revoked_at = ?2 WHERE id = ?1`).bind(sid, now).run();
    await audit(c.env, adminId, 'logout', null, null, now);
    return c.json({ ok: true });
  });

  app.get('/me', async (c) => {
    const id = await requireAdmin(c, deps.now());
    const u = await c.env.DB.prepare(`SELECT id, email FROM admin_users WHERE id = ?1`).bind(id).first();
    return c.json(u);
  });

  app.get('/businesses', async (c) => {
    await requireAdmin(c, deps.now());
    const q = (c.req.query('q') ?? '').trim();
    const page = Math.max(0, Number(c.req.query('page') ?? 0) | 0);
    const like = `%${q}%`;
    const r = await c.env.DB.prepare(
      `SELECT b.id, b.name, b.country, b.type, b.plan_code, ${effectiveStatusSql('b', '?4')} AS status, b.status AS stored_status, b.plan_expires_at, b.created_at, b.last_seen_at, b.app_version,
              a.phone AS owner_phone,
              (SELECT COUNT(*) FROM devices d WHERE d.business_id = b.id AND d.deactivated_at IS NULL) AS active_devices
       FROM businesses b JOIN accounts a ON a.id = b.owner_account_id
       WHERE (?1 = '' OR b.name LIKE ?2 OR a.phone LIKE ?2)
       ORDER BY b.created_at DESC LIMIT 50 OFFSET ?3`,
    )
      .bind(q, like, page * 50, deps.now())
      .all();
    return c.json({ businesses: r.results, page });
  });

  app.get('/businesses/:id', async (c) => {
    await requireAdmin(c, deps.now());
    const id = c.req.param('id');
    const b = await c.env.DB.prepare(
      `SELECT b.id, b.name, b.country, b.type, b.vat_registered, b.plan_code, ${effectiveStatusSql('b', '?2')} AS status, b.status AS stored_status, b.plan_source, b.plan_expires_at, b.created_at, b.last_seen_at, b.app_version, a.phone AS owner_phone
       FROM businesses b JOIN accounts a ON a.id = b.owner_account_id WHERE b.id = ?1`,
    )
      .bind(id, deps.now())
      .first();
    if (!b) throw new ApiError(404, 'not_found');
    const devices = await c.env.DB.prepare(`SELECT id, code, platform, model, app_version, activated_at, deactivated_at, last_checkin_at FROM devices WHERE business_id = ?1 ORDER BY activated_at DESC`)
      .bind(id)
      .all();
    const requests = await c.env.DB.prepare(`SELECT day, count FROM usage_daily WHERE business_id = ?1 AND metric = 'api_requests' ORDER BY day DESC LIMIT 14`).bind(id).all();
    const ocr = await c.env.DB.prepare(
      `SELECT SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM ocr_scans WHERE business_id = ?1 AND created_at >= ?2`,
    )
      .bind(id, cairoMonthStart(deps.now()))
      .first<{ ok: number | null; failed: number | null; input_tokens: number | null; output_tokens: number | null }>();
    return c.json({
      business: b,
      devices: devices.results,
      requests: requests.results,
      ocrMonth: { scans: ocr?.ok ?? 0, failed: ocr?.failed ?? 0, inputTokens: ocr?.input_tokens ?? 0, outputTokens: ocr?.output_tokens ?? 0 },
    });
  });

  app.post('/businesses/:id/extend-trial', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const { days } = await body(c, z.object({ days: z.number().int().min(1).max(365) }));
    const b = await c.env.DB.prepare(
      `SELECT b.status, b.plan_code, b.plan_expires_at, p.is_free FROM businesses b JOIN plans p ON p.code = b.plan_code WHERE b.id = ?1`,
    )
      .bind(id)
      .first<{ status: string; plan_code: string; plan_expires_at: number; is_free: number }>();
    if (!b) throw new ApiError(404, 'not_found');
    // Extending from "now" if the trial already ended, otherwise from the current end.
    const base = Math.max(now, b.plan_expires_at);
    const until = base + days * DAY_MS;
    // A paying customer (paid plan still running, or suspended) is never turned back into a trial: the days are a
    // gift on their current plan and status.
    const paying = b.status !== 'trial' && !b.is_free && (b.plan_expires_at > now || b.status === 'suspended');
    if (paying) {
      // A gift on a manual plan also extends the manual entitlement (it survives a later store purchase / expiry).
      await c.env.DB.prepare(
        `UPDATE businesses SET plan_expires_at = ?2,
           manual_until = CASE WHEN plan_source != 'store' AND manual_plan_code = plan_code THEN ?2 ELSE manual_until END WHERE id = ?1`,
      ).bind(id, until).run();
    } else {
      await c.env.DB.prepare(`UPDATE businesses SET status = 'trial', plan_code = 'pro', plan_expires_at = ?2 WHERE id = ?1 AND status != 'suspended'`).bind(id, until).run();
    }
    await audit(c.env, adminId, 'extend_trial', id, { days, from: b.plan_expires_at, to: until, previousStatus: b.status, kept: paying ? b.plan_code : null }, now);
    return c.json({ ok: true, planExpiresAt: until, keptPlan: paying });
  });

  app.post('/businesses/:id/plan', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const b = await body(c, z.object({ planCode: z.string(), expiresAt: z.number().int(), status: z.enum(['trial', 'active', 'past_due']) }));
    const plan = await c.env.DB.prepare(`SELECT code FROM plans WHERE code = ?1`).bind(b.planCode).first();
    if (!plan) throw new ApiError(400, 'invalid_request', 'unknown plan');
    const res = await c.env.DB.prepare(`UPDATE businesses SET plan_code = ?2, plan_expires_at = ?3, status = ?4 WHERE id = ?1`).bind(id, b.planCode, b.expiresAt, b.status).run();
    if (res.meta.changes !== 1) throw new ApiError(404, 'not_found');
    await audit(c.env, adminId, 'change_plan', id, b, now);
    return c.json({ ok: true });
  });

  app.post('/businesses/:id/suspend', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const { suspended } = await body(c, z.object({ suspended: z.boolean() }));
    const b = await c.env.DB.prepare(`SELECT status, status_before_suspend, plan_expires_at FROM businesses WHERE id = ?1`)
      .bind(id)
      .first<{ status: string; status_before_suspend: string | null; plan_expires_at: number }>();
    if (!b) throw new ApiError(404, 'not_found');
    let status: string;
    if (suspended) {
      status = 'suspended';
      // Remember what to restore (a second suspend keeps the original).
      if (b.status !== 'suspended') await c.env.DB.prepare(`UPDATE businesses SET status = 'suspended', status_before_suspend = ?2 WHERE id = ?1`).bind(id, b.status).run();
    } else {
      if (b.status !== 'suspended') return c.json({ ok: true, status: b.status });
      status = b.status_before_suspend ?? (b.plan_expires_at > now ? 'active' : 'past_due');
      await c.env.DB.prepare(`UPDATE businesses SET status = ?2, status_before_suspend = NULL WHERE id = ?1 AND status = 'suspended'`).bind(id, status).run();
    }
    await audit(c.env, adminId, suspended ? 'suspend' : 'unsuspend', id, { from: b.status, to: status }, now);
    return c.json({ ok: true, status });
  });

  app.get('/plans', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(`SELECT * FROM plans ORDER BY monthly_egp`).all<{ limits_json: string; features_json: string }>();
    return c.json({ plans: r.results.map((p) => ({ ...p, limits: JSON.parse(p.limits_json), features: JSON.parse(p.features_json) })) });
  });

  app.put('/plans/:code', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const code = c.req.param('code');
    if (!/^[a-z0-9_-]{2,20}$/.test(code)) throw new ApiError(400, 'invalid_request', 'bad plan code');
    const p = await body(c, planSchema);
    await c.env.DB.prepare(
      `INSERT INTO plans (code, name_ar, name_en, monthly_egp, monthly_sar, yearly_egp, yearly_sar, limits_json, features_json, is_free, trial_days, active, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT (code) DO UPDATE SET name_ar = ?2, name_en = ?3, monthly_egp = ?4, monthly_sar = ?5, yearly_egp = ?6, yearly_sar = ?7,
         limits_json = ?8, features_json = ?9, is_free = ?10, trial_days = ?11, active = ?12, updated_at = ?13`,
    )
      .bind(
        code,
        p.nameAr,
        p.nameEn,
        p.monthlyEgp,
        p.monthlySar,
        p.yearlyEgp,
        p.yearlySar,
        JSON.stringify(p.limits),
        JSON.stringify(p.features),
        p.monthlyEgp === 0 && p.monthlySar === 0 ? 1 : 0,
        p.trialDays,
        p.active ? 1 : 0,
        now,
      )
      .run();
    await audit(c.env, adminId, 'upsert_plan', code, p, now);
    return c.json({ ok: true });
  });

  app.get('/settings', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(`SELECT key, value FROM app_settings`).all<{ key: string; value: string }>();
    return c.json(Object.fromEntries(r.results.map((x) => [x.key, x.value])));
  });

  app.put('/settings/ads', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const { enabled } = await body(c, z.object({ enabled: z.boolean() }));
    await c.env.DB.prepare(`UPDATE app_settings SET value = ?1 WHERE key = 'ads_enabled'`).bind(String(enabled)).run();
    await audit(c.env, adminId, 'ads_switch', null, { enabled }, now);
    return c.json({ ok: true });
  });

  /** Manual-payment numbers shown in the app + the activation SLA (hours). */
  app.put('/settings/payments', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const b = await body(c, z.object({ instapay: z.string().trim().min(3).max(60), vodafoneCash: z.string().trim().regex(/^01[0125]\d{8}$/), slaHours: z.number().int().min(1).max(168) }));
    await c.env.DB.batch(
      (
        [
          ['pay_instapay', b.instapay],
          ['pay_vodafone_cash', b.vodafoneCash],
          ['pay_sla_hours', String(b.slaHours)],
        ] as const
      ).map(([k, v]) => c.env.DB.prepare(`INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2`).bind(k, v)),
    );
    await audit(c.env, adminId, 'payment_settings', null, b, now);
    return c.json({ ok: true });
  });

  app.get('/audit', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(
      `SELECT l.id, l.action, l.target, l.details_json, l.at, u.email FROM admin_audit l JOIN admin_users u ON u.id = l.admin_id ORDER BY l.at DESC LIMIT 200`,
    ).all();
    return c.json({ entries: r.results });
  });

  // ── Activation codes (sales reps / cash payments) ──
  app.post('/codes', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const b = await body(c, z.object({ planCode: z.string(), days: z.number().int().min(1).max(3660), count: z.number().int().min(1).max(500), note: z.string().max(120).optional() }));
    const plan = await c.env.DB.prepare(`SELECT code FROM plans WHERE code = ?1 AND is_free = 0`).bind(b.planCode).first();
    if (!plan) throw new ApiError(400, 'invalid_request', 'plan');
    const batch = uuidv7(now);
    const codes: string[] = [];
    while (codes.length < b.count) {
      const code = newActivationCode();
      if (!codes.includes(code)) codes.push(code);
    }
    await c.env.DB.batch(codes.map((code) => c.env.DB.prepare(`INSERT INTO activation_codes (code, plan_code, days, batch, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(code, b.planCode, b.days, batch, b.note ?? null, adminId, now)));
    await audit(c.env, adminId, 'codes_generate', batch, { plan: b.planCode, days: b.days, count: b.count }, now);
    return c.json({ batch, codes }, 201);
  });

  app.get('/codes', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(
      `SELECT k.code, k.plan_code, k.days, k.batch, k.note, k.created_at, k.redeemed_at, k.revoked_at, b.name AS business_name
       FROM activation_codes k LEFT JOIN businesses b ON b.id = k.redeemed_business_id ORDER BY k.created_at DESC LIMIT 500`,
    ).all();
    return c.json({ codes: r.results });
  });

  app.post('/codes/:code/revoke', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const r = await c.env.DB.prepare(`UPDATE activation_codes SET revoked_at = ?2 WHERE code = ?1 AND redeemed_at IS NULL AND revoked_at IS NULL`).bind(c.req.param('code'), now).run();
    if (r.meta.changes !== 1) throw new ApiError(404, 'not_found');
    await audit(c.env, adminId, 'code_revoke', c.req.param('code'), null, now);
    return c.json({ ok: true });
  });

  // ── Announcements to users (push + in-app inbox via check-in) ──
  /** Preview: how many businesses / phones / push-enabled phones a target reaches. */
  app.post('/announcements/preview', async (c) => {
    await requireAdmin(c, deps.now());
    const t = await body(c, targetSchema);
    return c.json(await reach(c.env, t, deps.now()));
  });

  app.post('/announcements', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const b = await body(c, announceSchema);
    const id = uuidv7(now);
    await c.env.DB.prepare(
      `INSERT INTO announcements (id, title_ar, body_ar, title_en, body_en, url, target_json, push, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
    )
      .bind(id, b.titleAr, b.bodyAr, b.titleEn || null, b.bodyEn || null, b.url ?? null, JSON.stringify(b.target), b.push ? 1 : 0, adminId, now, now + b.days * DAY_MS)
      .run();
    let sent = 0;
    let failed = 0;
    const r = await reach(c.env, b.target, now, true);
    if (b.push && r.tokens.length && deps.push) {
      [sent, failed] = await deps.push(
        c.env,
        r.tokens.map((to) => ({ to, title: b.titleAr, body: b.bodyAr, sound: 'default' as const, channelId: 'default', data: { kind: 'announcement', id, url: b.url ?? null } })),
      );
      await c.env.DB.prepare(`UPDATE announcements SET push_sent = ?2, push_failed = ?3 WHERE id = ?1`).bind(id, sent, failed).run();
    }
    await audit(c.env, adminId, 'announce', id, { title: b.titleAr, target: b.target, businesses: r.businesses, pushSent: sent }, now);
    return c.json({ id, businesses: r.businesses, devices: r.devices, pushSent: sent, pushFailed: failed }, 201);
  });

  app.get('/announcements', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(
      `SELECT a.id, a.title_ar, a.body_ar, a.url, a.target_json, a.push_sent, a.push_failed, a.delivered, a.created_at, a.expires_at, a.cancelled_at, u.email
       FROM announcements a LEFT JOIN admin_users u ON u.id = a.created_by ORDER BY a.created_at DESC LIMIT 200`,
    ).all();
    return c.json({ announcements: r.results });
  });

  /** Withdraw: phones that have not checked in yet will not receive it (already-delivered copies stay). */
  app.post('/announcements/:id/cancel', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const r = await c.env.DB.prepare(`UPDATE announcements SET cancelled_at = ?2 WHERE id = ?1 AND cancelled_at IS NULL`).bind(c.req.param('id'), now).run();
    if (r.meta.changes !== 1) throw new ApiError(404, 'not_found');
    await audit(c.env, adminId, 'announce_cancel', c.req.param('id'), null, now);
    return c.json({ ok: true });
  });

  // ── Manual payments (InstaPay / Vodafone Cash receipts) ──
  app.get('/payment-requests', async (c) => {
    await requireAdmin(c, deps.now());
    const status = c.req.query('status') ?? 'pending';
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw new ApiError(400, 'invalid_request', 'status');
    const r = await c.env.DB.prepare(
      `SELECT r.id, r.business_id, b.name AS business_name, a.phone AS owner_phone, r.plan_code, p.name_ar AS plan_name_ar, r.period, r.amount_minor, r.currency,
              r.method, r.payer_phone, r.note, r.reference, r.receipt_sha256, r.status, r.reject_reason, r.reviewed_at, u.email AS reviewed_by_email, r.created_at,
              b.plan_code AS business_plan_code, b.plan_expires_at AS business_plan_expires_at, ${effectiveStatusSql('b', '?2')} AS business_status,
              CASE WHEN r.receipt_sha256 IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM payment_requests x WHERE x.receipt_sha256 = r.receipt_sha256 AND x.id != r.id) END AS duplicate_receipts
       FROM payment_requests r
       JOIN businesses b ON b.id = r.business_id
       JOIN accounts a ON a.id = b.owner_account_id
       LEFT JOIN plans p ON p.code = r.plan_code
       LEFT JOIN admin_users u ON u.id = r.reviewed_by
       WHERE (?1 = 'all' OR r.status = ?1)
       ORDER BY CASE WHEN r.status = 'pending' THEN r.created_at END ASC, r.created_at DESC LIMIT 200`,
    )
      .bind(status, deps.now())
      .all();
    const pending = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM payment_requests WHERE status = 'pending'`).first<{ n: number }>();
    return c.json({ requests: r.results, pendingCount: pending?.n ?? 0 });
  });

  /** Streams the receipt image (admin only; there is no public URL). */
  app.get('/payment-requests/:id/receipt', async (c) => {
    await requireAdmin(c, deps.now());
    const row = await c.env.DB.prepare(`SELECT receipt_key FROM payment_requests WHERE id = ?1`).bind(c.req.param('id')).first<{ receipt_key: string }>();
    if (!row) throw new ApiError(404, 'not_found');
    const obj = await c.env.BACKUPS.get(row.receipt_key);
    if (!obj) throw new ApiError(404, 'not_found', 'receipt missing');
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType ?? receiptContentType(row.receipt_key),
        'Content-Length': String(obj.size),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.post('/payment-requests/:id/approve', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const b = await body(c, z.object({ days: z.number().int().min(1).max(3660).optional(), allowSuspended: z.boolean().optional() }));
    const req = await c.env.DB.prepare(`SELECT business_id, plan_code, period, amount_minor, status FROM payment_requests WHERE id = ?1`).bind(id).first<{
      business_id: string;
      plan_code: string;
      period: 'monthly' | 'yearly';
      amount_minor: number;
      status: string;
    }>();
    if (!req) throw new ApiError(404, 'not_found');
    if (req.status !== 'pending') throw new ApiError(409, 'not_pending', 'request already reviewed');
    const business = (await c.env.DB.prepare(`SELECT id, plan_code, plan_expires_at, status, country FROM businesses WHERE id = ?1`)
      .bind(req.business_id)
      .first<{ id: string; plan_code: string; plan_expires_at: number; status: string; country: string }>())!;
    // Never lift (or silently pay into) a suspension: the admin confirms explicitly; the business stays suspended.
    if (business.status === 'suspended' && !b.allowSuspended) throw new ApiError(409, 'business_suspended', 'business is suspended: confirm to activate the plan anyway (it stays suspended)');
    const days = b.days ?? (req.period === 'yearly' ? 366 : 31);
    const { until, creditDays } = await planActivation(c.env, business, req.plan_code, days, now);
    // Approve + activate in ONE batch (a D1 batch is a transaction): only the call that flipped the request to
    // approved (its nonce) activates the plan, so a double click or two admins can never activate twice. The flip
    // also requires the business plan / expiry to be exactly what `until` was computed from: two approvals for the
    // same shop in parallel cannot overwrite each other's days (the loser gets 409 concurrent_update and retries).
    const nonce = uuidv7(now);
    const res = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE payment_requests SET status = 'approved', reviewed_by = ?2, reviewed_at = ?3, review_nonce = ?4
         WHERE id = ?1 AND status = 'pending' AND EXISTS (SELECT 1 FROM businesses WHERE id = ?5 AND plan_code = ?6 AND plan_expires_at = ?7)`,
      ).bind(id, adminId, now, nonce, business.id, business.plan_code, business.plan_expires_at),
      activationStatement(c.env, business.id, req.plan_code, until, 'manual', req.period, {
        sql: `EXISTS (SELECT 1 FROM payment_requests WHERE id = ?6 AND review_nonce = ?7)`,
        args: [id, nonce],
      }),
    ]);
    if (res[0]!.meta.changes !== 1) {
      const st = await c.env.DB.prepare(`SELECT status FROM payment_requests WHERE id = ?1`).bind(id).first<{ status: string }>();
      if (st?.status === 'pending') throw new ApiError(409, 'concurrent_update', 'the plan changed meanwhile (another approval?), try again');
      throw new ApiError(409, 'not_pending', 'request already reviewed');
    }
    const plan = await c.env.DB.prepare(`SELECT name_ar FROM plans WHERE code = ?1`).bind(req.plan_code).first<{ name_ar: string }>();
    const annId = await notifyBusiness(
      c.env,
      adminId,
      req.business_id,
      'تم تفعيل باقتك 🎉',
      `استلمنا تحويلك وتم تفعيل باقة «${plan?.name_ar ?? req.plan_code}» (${req.period === 'yearly' ? 'سنوي' : 'شهري'}) لحد ${arDate(until)}. شكراً لثقتك!`,
      now,
    );
    await audit(c.env, adminId, 'payment_approve', id, { businessId: req.business_id, plan: req.plan_code, period: req.period, amountMinor: req.amount_minor, days, creditDays, expiresAt: until, fromPlan: business.plan_code, fromExpiry: business.plan_expires_at, suspended: business.status === 'suspended', announcement: annId }, now);
    return c.json({ ok: true, planExpiresAt: until, creditDays });
  });

  app.post('/payment-requests/:id/reject', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const { reason } = await body(c, z.object({ reason: z.string().trim().min(2).max(200) }));
    const req = await c.env.DB.prepare(`SELECT business_id FROM payment_requests WHERE id = ?1`).bind(id).first<{ business_id: string }>();
    if (!req) throw new ApiError(404, 'not_found');
    const upd = await c.env.DB.prepare(`UPDATE payment_requests SET status = 'rejected', reject_reason = ?2, reviewed_by = ?3, reviewed_at = ?4 WHERE id = ?1 AND status = 'pending'`)
      .bind(id, reason, adminId, now)
      .run();
    if (upd.meta.changes !== 1) throw new ApiError(409, 'not_pending', 'request already reviewed');
    const annId = await notifyBusiness(c.env, adminId, req.business_id, 'طلب الدفع اترفض', `السبب: ${reason}\nمن فضلك راجع التحويل وابعت الطلب تاني بصورة إيصال واضحة.`, now);
    await audit(c.env, adminId, 'payment_reject', id, { businessId: req.business_id, reason, announcement: annId }, now);
    return c.json({ ok: true });
  });

  /** Targeted announcement (in-app inbox + push) to one business. */
  async function notifyBusiness(env: Env, adminId: string, businessId: string, titleAr: string, bodyAr: string, now: number): Promise<string> {
    const id = uuidv7(now);
    const target: Target = { businessIds: [businessId] };
    await env.DB.prepare(
      `INSERT INTO announcements (id, title_ar, body_ar, url, target_json, push, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, '/settings/subscription', ?4, 1, ?5, ?6, ?7)`,
    )
      .bind(id, titleAr, bodyAr, JSON.stringify(target), adminId, now, now + 14 * DAY_MS)
      .run();
    const r = await reach(env, target, now, true);
    if (r.tokens.length && deps.push) {
      try {
        const [sent, failed] = await deps.push(
          env,
          r.tokens.map((to) => ({ to, title: titleAr, body: bodyAr, sound: 'default' as const, channelId: 'default', data: { kind: 'announcement', id, url: '/settings/subscription' } })),
        );
        await env.DB.prepare(`UPDATE announcements SET push_sent = ?2, push_failed = ?3 WHERE id = ?1`).bind(id, sent, failed).run();
      } catch {
        // push is best-effort; the inbox copy still arrives with the next check-in
      }
    }
    return id;
  }

  /** Crash reports sent by the app (read-only, newest first). */
  app.get('/client-errors', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(`SELECT id, where_ AS place, message, stack, app_version, platform, at FROM client_errors ORDER BY at DESC LIMIT 200`).all();
    return c.json({ errors: r.results });
  });

  /** Dashboard: active, trials, paid by plan, MRR (monthly-equivalent), churn (30 days), requests per business/day. */
  app.get('/metrics', async (c) => {
    const now = deps.now();
    await requireAdmin(c, now);
    const d30 = now - 30 * DAY_MS;
    const q = <T>(sql: string, ...args: unknown[]) => c.env.DB.prepare(sql).bind(...args).first<T>();
    const total = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM businesses`);
    const active = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM businesses WHERE last_seen_at > ?1`, d30);
    const trials = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM businesses WHERE status = 'trial' AND plan_expires_at > ?1`, now);
    const paid = await c.env.DB.prepare(
      `SELECT b.plan_code, b.billing_period, b.country, COUNT(*) AS n, p.monthly_egp, p.monthly_sar, p.yearly_egp, p.yearly_sar
       FROM businesses b JOIN plans p ON p.code = b.plan_code
       WHERE b.status IN ('active','past_due') AND b.plan_expires_at > ?1 AND p.is_free = 0
       GROUP BY b.plan_code, b.billing_period, b.country`,
    )
      .bind(now)
      .all<{ plan_code: string; billing_period: string | null; country: 'EG' | 'SA'; n: number; monthly_egp: number; monthly_sar: number; yearly_egp: number; yearly_sar: number }>();
    const mrr = { EGP: 0, SAR: 0 };
    const byPlan: Record<string, number> = {};
    for (const r of paid.results) {
      byPlan[r.plan_code] = (byPlan[r.plan_code] ?? 0) + r.n;
      const cur = r.country === 'SA' ? 'SAR' : 'EGP';
      const monthly = r.billing_period === 'yearly' ? Math.round((cur === 'SAR' ? r.yearly_sar : r.yearly_egp) / 12) : cur === 'SAR' ? r.monthly_sar : r.monthly_egp;
      mrr[cur] += monthly * r.n;
    }
    const paidNow = Object.values(byPlan).reduce((a, b) => a + b, 0);
    const lapsed = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM businesses b JOIN plans p ON p.code = b.plan_code WHERE p.is_free = 0 AND b.status != 'trial' AND b.plan_expires_at BETWEEN ?1 AND ?2`, d30, now);
    const churn = paidNow + (lapsed?.n ?? 0) ? (lapsed?.n ?? 0) / (paidNow + (lapsed?.n ?? 0)) : 0;
    const req = await q<{ avg: number | null; max: number | null }>(
      `SELECT AVG(count) AS avg, MAX(count) AS max FROM usage_daily WHERE business_id != '*' AND metric = 'api_requests' AND day >= ?1`,
      cairoDayMinus(now, 7),
    );
    // Dashboard banner: any global gauge above 70 % of the Cloudflare free tier today.
    const tier = await freeTierStatus(c.env, now).catch(() => null);
    const usageAlert = tier && tier.maxPct >= 70 ? { day: cairoDay(now), gauges: tier.gauges.filter((g) => g.pct >= 70) } : null;
    const pendingPayments = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM payment_requests WHERE status = 'pending'`);
    const expired = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM businesses b WHERE ${effectiveStatusSql('b', '?1')} = 'expired'`, now);
    const ocr = await q<{ n: number; tin: number | null; tout: number | null }>(
      `SELECT COUNT(*) AS n, SUM(input_tokens) AS tin, SUM(output_tokens) AS tout FROM ocr_scans WHERE status = 'ok' AND created_at >= ?1`,
      cairoMonthStart(now),
    );
    return c.json({ usageAlert, ocrMonth: { scans: ocr?.n ?? 0, inputTokens: ocr?.tin ?? 0, outputTokens: ocr?.tout ?? 0 }, pendingPayments: pendingPayments?.n ?? 0, expired: expired?.n ?? 0, total: total?.n ?? 0, active30: active?.n ?? 0, trials: trials?.n ?? 0, paid: paidNow, byPlan, mrrMinor: mrr, churn30: churn, requestsPerBusinessDay: { avg: req?.avg ?? 0, max: req?.max ?? 0 } });
  });

  addUsageAdminRoutes(app, deps, requireAdmin, audit);
  return app;
}
