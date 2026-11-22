/**
 * Super-admin API (`/admin`). Login = email + password + TOTP (all three required).
 * Bearer session token held in the admin SPA's sessionStorage; CORS limited to ADMIN_ORIGIN.
 * Every mutating action is written to admin_audit.
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { DAY_MS, FEATURES, uuidv7, verifyTotp } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { pbkdf2Hex, randomToken, safeEqual, sha256HexAsync } from '../lib/crypto';
import type { Deps } from '../routes/v1';
import { defaultDeps } from '../routes/v1';

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
  }),
  features: z.array(z.enum(FEATURES)),
  trialDays: z.number().int().min(0).max(90),
  active: z.boolean(),
});

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
      `SELECT b.id, b.name, b.country, b.type, b.plan_code, b.status, b.plan_expires_at, b.created_at, b.last_seen_at, b.app_version,
              a.phone AS owner_phone,
              (SELECT COUNT(*) FROM devices d WHERE d.business_id = b.id AND d.deactivated_at IS NULL) AS active_devices
       FROM businesses b JOIN accounts a ON a.id = b.owner_account_id
       WHERE (?1 = '' OR b.name LIKE ?2 OR a.phone LIKE ?2)
       ORDER BY b.created_at DESC LIMIT 50 OFFSET ?3`,
    )
      .bind(q, like, page * 50)
      .all();
    return c.json({ businesses: r.results, page });
  });

  app.get('/businesses/:id', async (c) => {
    await requireAdmin(c, deps.now());
    const id = c.req.param('id');
    const b = await c.env.DB.prepare(
      `SELECT b.id, b.name, b.country, b.type, b.vat_registered, b.plan_code, b.status, b.plan_expires_at, b.created_at, b.last_seen_at, b.app_version, a.phone AS owner_phone
       FROM businesses b JOIN accounts a ON a.id = b.owner_account_id WHERE b.id = ?1`,
    )
      .bind(id)
      .first();
    if (!b) throw new ApiError(404, 'not_found');
    const devices = await c.env.DB.prepare(`SELECT id, code, platform, model, app_version, activated_at, deactivated_at, last_checkin_at FROM devices WHERE business_id = ?1 ORDER BY activated_at DESC`)
      .bind(id)
      .all();
    const requests = await c.env.DB.prepare(`SELECT day, count FROM request_counters WHERE business_id = ?1 ORDER BY day DESC LIMIT 14`).bind(id).all();
    return c.json({ business: b, devices: devices.results, requests: requests.results });
  });

  app.post('/businesses/:id/extend-trial', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const { days } = await body(c, z.object({ days: z.number().int().min(1).max(365) }));
    const b = await c.env.DB.prepare(`SELECT status, plan_expires_at FROM businesses WHERE id = ?1`).bind(id).first<{ status: string; plan_expires_at: number }>();
    if (!b) throw new ApiError(404, 'not_found');
    // Extending from "now" if the trial already ended, otherwise from the current end.
    const base = Math.max(now, b.plan_expires_at);
    const until = base + days * DAY_MS;
    await c.env.DB.prepare(`UPDATE businesses SET status = 'trial', plan_code = 'pro', plan_expires_at = ?2 WHERE id = ?1`).bind(id, until).run();
    await audit(c.env, adminId, 'extend_trial', id, { days, from: b.plan_expires_at, to: until, previousStatus: b.status }, now);
    return c.json({ ok: true, planExpiresAt: until });
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
    const b = await c.env.DB.prepare(`SELECT plan_expires_at FROM businesses WHERE id = ?1`).bind(id).first<{ plan_expires_at: number }>();
    if (!b) throw new ApiError(404, 'not_found');
    const status = suspended ? 'suspended' : b.plan_expires_at > now ? 'active' : 'past_due';
    await c.env.DB.prepare(`UPDATE businesses SET status = ?2 WHERE id = ?1`).bind(id, status).run();
    await audit(c.env, adminId, suspended ? 'suspend' : 'unsuspend', id, null, now);
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

  app.get('/audit', async (c) => {
    await requireAdmin(c, deps.now());
    const r = await c.env.DB.prepare(
      `SELECT l.id, l.action, l.target, l.details_json, l.at, u.email FROM admin_audit l JOIN admin_users u ON u.id = l.admin_id ORDER BY l.at DESC LIMIT 200`,
    ).all();
    return c.json({ entries: r.results });
  });

  return app;
}
