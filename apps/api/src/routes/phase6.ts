/**
 * Phase 6 endpoints: cloud backups (presigned R2), backup-key release (step-up), restore/activate on a new phone,
 * activation codes, RevenueCat webhook. Mounted under /v1 by v1Routes.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { DAY_MS, attachDeviceSchema, backupUploadSchema, base64urlEncode, uuidv7 } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { safeEqual, unwrapSecret } from '../lib/crypto';
import { requireSession } from '../auth/tokens';
import { getPlan, type BusinessRow } from '../licence/issue';
import { presign } from '../backups/r2';
import { activatePlan } from '../billing/activate';
import type { Deps } from './v1';

type CheckIntegrity = (env: Env, input: z.infer<typeof attachDeviceSchema>['integrity'], action: 'signup' | 'activate' | 'checkin', now: number) => Promise<unknown>;
let checkIntegrityFn: CheckIntegrity = async () => undefined;
export function setIntegrityChecker(f: CheckIntegrity) {
  checkIntegrityFn = f;
}

type RegisterDevice = (env: Env, business: BusinessRow, sessionId: string, device: z.infer<typeof attachDeviceSchema>['device'], now: number) => Promise<unknown>;

export async function ownedBusiness(env: Env, businessId: string, accountId: string): Promise<BusinessRow> {
  const b = await env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1 AND owner_account_id = ?2`).bind(businessId, accountId).first<BusinessRow>();
  if (!b) throw new ApiError(404, 'not_found');
  return b;
}

/** Create a pending backup row + presigned PUT. Used by /backups/upload-url and by check-in (backupMeta). */
export async function startBackup(env: Env, businessId: string, deviceId: string, meta: { size: number; sha256: string; counts: Record<string, number>; schemaVersion: number }, kind: 'auto' | 'manual', now: number) {
  const dev = await env.DB.prepare(`SELECT id, deactivated_at FROM devices WHERE id = ?1 AND business_id = ?2`).bind(deviceId, businessId).first<{ id: string; deactivated_at: number | null }>();
  if (!dev) throw new ApiError(404, 'not_found', 'device');
  if (dev.deactivated_at) throw new ApiError(403, 'device_deactivated');
  const id = uuidv7(now);
  const key = `b/${businessId}/${deviceId}/${id}.obk`;
  await env.DB.prepare(
    `INSERT INTO backups (id, business_id, device_id, r2_key, size, sha256, counts_json, schema_version, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  )
    .bind(id, businessId, deviceId, key, meta.size, meta.sha256, JSON.stringify(meta.counts), meta.schemaVersion, kind, now)
    .run();
  const put = await presign(env, key, 'PUT', meta.size);
  return { backupId: id, ...put };
}

/** Verify the uploaded object (exact size) and apply plan retention (keep the newest N). */
export async function commitBackup(env: Env, backupId: string, businessId: string, now: number): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT * FROM backups WHERE id = ?1 AND business_id = ?2`).bind(backupId, businessId).first<{ r2_key: string; size: number; committed_at: number | null }>();
  if (!row) throw new ApiError(404, 'not_found');
  if (row.committed_at) return true;
  const head = await env.BACKUPS.head(row.r2_key);
  if (!head || head.size !== row.size) throw new ApiError(409, 'backup_not_uploaded');
  await env.DB.prepare(`UPDATE backups SET committed_at = ?2 WHERE id = ?1`).bind(backupId, now).run();
  const biz = await env.DB.prepare(`SELECT plan_code FROM businesses WHERE id = ?1`).bind(businessId).first<{ plan_code: string }>();
  const keep = JSON.parse((await getPlan(env, biz!.plan_code)).limits_json).backups_kept as number;
  if (keep > 0) {
    const old = await env.DB.prepare(`SELECT id, r2_key FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL ORDER BY committed_at DESC LIMIT -1 OFFSET ?2`)
      .bind(businessId, keep)
      .all<{ id: string; r2_key: string }>();
    if (old.results.length) {
      await env.BACKUPS.delete(old.results.map((o) => o.r2_key));
      await env.DB.batch(old.results.map((o) => env.DB.prepare(`DELETE FROM backups WHERE id = ?1`).bind(o.id)));
    }
  }
  // Uncommitted leftovers older than a day are garbage.
  await env.DB.prepare(`DELETE FROM backups WHERE business_id = ?1 AND committed_at IS NULL AND created_at < ?2`).bind(businessId, now - DAY_MS).run();
  return true;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newActivationCode(): string {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const s = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Store product id → plan / period, e.g. "daftarak_pro_yearly" or "daftarak.basic.monthly". */
export function planFromProduct(productId: string | null | undefined): { plan: string; period: 'monthly' | 'yearly' } | null {
  const m = /(basic|pro)[._-]?(monthly|yearly|month|year|annual)?/i.exec(productId ?? '');
  if (!m) return null;
  const p = (m[2] ?? 'monthly').toLowerCase();
  return { plan: m[1]!.toLowerCase(), period: p.startsWith('year') || p === 'annual' ? 'yearly' : 'monthly' };
}

export function addPhase6Routes(app: Hono<AppEnv>, deps: Deps, registerDevice: RegisterDevice, countRequest: (env: Env, businessId: string, now: number) => Promise<void>) {
  /** Manual "backup now". */
  app.post('/backups/upload-url', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, backupUploadSchema);
    await ownedBusiness(c.env, b.businessId, s.aid);
    const put = await startBackup(c.env, b.businessId, b.deviceId, b.meta, b.kind, now);
    await countRequest(c.env, b.businessId, now);
    return c.json(put);
  });

  app.post('/backups/:id/commit', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, z.object({ businessId: z.string() }));
    await ownedBusiness(c.env, b.businessId, s.aid);
    await commitBackup(c.env, c.req.param('id'), b.businessId, now);
    await countRequest(c.env, b.businessId, now);
    return c.json({ ok: true });
  });

  /** List committed backups (for restore / the backup screen). */
  app.get('/backups', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const businessId = c.req.query('businessId') ?? '';
    await ownedBusiness(c.env, businessId, s.aid);
    const r = await c.env.DB.prepare(
      `SELECT b.id, b.size, b.counts_json, b.schema_version, b.kind, b.committed_at, d.code AS device_code, d.model
       FROM backups b LEFT JOIN devices d ON d.id = b.device_id WHERE b.business_id = ?1 AND b.committed_at IS NOT NULL ORDER BY b.committed_at DESC LIMIT 60`,
    )
      .bind(businessId)
      .all<{ id: string; size: number; counts_json: string; schema_version: number; kind: string; committed_at: number; device_code: string | null; model: string | null }>();
    return c.json({ backups: r.results.map((x) => ({ id: x.id, size: x.size, counts: JSON.parse(x.counts_json), schemaVersion: x.schema_version, kind: x.kind, at: x.committed_at, deviceCode: x.device_code, model: x.model })) });
  });

  app.post('/backups/:id/download-url', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const row = await c.env.DB.prepare(`SELECT b.r2_key, b.business_id, b.sha256, b.size FROM backups b JOIN businesses z ON z.id = b.business_id WHERE b.id = ?1 AND z.owner_account_id = ?2 AND b.committed_at IS NOT NULL`)
      .bind(c.req.param('id'), s.aid)
      .first<{ r2_key: string; business_id: string; sha256: string; size: number }>();
    if (!row) throw new ApiError(404, 'not_found');
    return c.json({ ...(await presign(c.env, row.r2_key, 'GET')), sha256: row.sha256, size: row.size });
  });

  /** Release the backup key — only with a fresh step-up OTP (≤ 10 min). Audit-logged. */
  app.post('/backups/key', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    if (!s.stepUpUntil || s.stepUpUntil < now) throw new ApiError(403, 'step_up_required');
    const b = await body(c, z.object({ businessId: z.string() }));
    const biz = await c.env.DB.prepare(`SELECT backup_key_wrapped FROM businesses WHERE id = ?1 AND owner_account_id = ?2`).bind(b.businessId, s.aid).first<{ backup_key_wrapped: string }>();
    if (!biz) throw new ApiError(404, 'not_found');
    const key = await unwrapSecret(biz.backup_key_wrapped, c.env.BACKUP_WRAP_KEY);
    await c.env.DB.prepare(`INSERT INTO key_releases (id, business_id, session_id, ip, at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(uuidv7(now), b.businessId, s.sid, clientIp(c), now).run();
    return c.json({ backupKey: base64urlEncode(key) });
  });

  /** After a restore on a new phone: register it (new device code) and deactivate the old one. Step-up required. */
  app.post('/devices/activate', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    if (!s.stepUpUntil || s.stepUpUntil < now) throw new ApiError(403, 'step_up_required');
    const b = await body(c, attachDeviceSchema.extend({ backupId: z.string().optional() }));
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    await checkIntegrityFn(c.env, b.integrity, 'activate', now);
    const registration = await registerDevice(c.env, business, s.sid, b.device, now);
    await countRequest(c.env, business.id, now);
    return c.json({ business: { id: business.id, name: business.name, country: business.country, type: business.type, role: 'owner' }, registration });
  });

  /** Redeem a sales-rep activation code (cash payments / agents). */
  app.post('/licence/activation-code', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, z.object({ businessId: z.string(), code: z.string().min(8).max(20) }));
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    const code = b.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(.{4})(.{4})/, '$1-$2-$3');
    const row = await c.env.DB.prepare(`SELECT * FROM activation_codes WHERE code = ?1`).bind(code).first<{ plan_code: string; days: number; redeemed_at: number | null; revoked_at: number | null }>();
    if (!row || row.revoked_at) throw new ApiError(404, 'code_invalid');
    if (row.redeemed_at) throw new ApiError(409, 'code_used');
    const upd = await c.env.DB.prepare(`UPDATE activation_codes SET redeemed_at = ?2, redeemed_business_id = ?3 WHERE code = ?1 AND redeemed_at IS NULL`).bind(code, now, business.id).run();
    if (upd.meta.changes !== 1) throw new ApiError(409, 'code_used');
    // Extends from the current expiry when renewing the same plan; otherwise starts now.
    const until = await activatePlan(c.env, business, row.plan_code, row.days, 'code', now);
    await countRequest(c.env, business.id, now);
    return c.json({ plan: row.plan_code, expiresAt: until });
  });

  /**
   * RevenueCat webhook (Authorization header = shared secret). app_user_id = business id.
   * Idempotent by event id. Purchases/renewals set the plan until the store expiry; billing issues → past_due;
   * cancellation keeps access until expiry; expiration needs no action (the licence falls to grace → free plan).
   */
  app.post('/webhooks/revenuecat', async (c) => {
    const now = deps.now();
    if (!safeEqual(c.req.header('Authorization') ?? '', `Bearer ${c.env.REVENUECAT_WEBHOOK_SECRET}`) && !safeEqual(c.req.header('Authorization') ?? '', c.env.REVENUECAT_WEBHOOK_SECRET)) throw new ApiError(401, 'unauthorized');
    const payload = await body(
      c,
      z.object({
        event: z.object({
          id: z.string(),
          type: z.string(),
          app_user_id: z.string().optional(),
          original_app_user_id: z.string().optional(),
          product_id: z.string().nullish(),
          expiration_at_ms: z.number().nullish(),
        }).passthrough(),
      }).passthrough(),
    );
    const e = payload.event;
    const businessId = e.app_user_id ?? e.original_app_user_id ?? null;
    const seen = await c.env.DB.prepare(`SELECT id FROM billing_events WHERE id = ?1`).bind(e.id).first();
    if (seen) return c.json({ ok: true, duplicate: true });
    const mapped = planFromProduct(e.product_id);
    await c.env.DB.prepare(`INSERT INTO billing_events (id, business_id, type, product_id, plan_code, expires_at, raw_json, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
      .bind(e.id, businessId, e.type, e.product_id ?? null, mapped?.plan ?? null, e.expiration_at_ms ?? null, JSON.stringify(payload), now)
      .run();
    if (!businessId) return c.json({ ok: true });
    const biz = await c.env.DB.prepare(`SELECT id FROM businesses WHERE id = ?1`).bind(businessId).first();
    if (!biz) return c.json({ ok: true, unknownBusiness: true });
    switch (e.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
      case 'NON_RENEWING_PURCHASE':
        if (mapped && e.expiration_at_ms) {
          await c.env.DB.prepare(`UPDATE businesses SET plan_code = ?2, status = 'active', plan_expires_at = ?3, plan_source = 'store', billing_period = ?4 WHERE id = ?1`)
            .bind(businessId, mapped.plan, e.expiration_at_ms, mapped.period)
            .run();
        }
        break;
      case 'BILLING_ISSUE':
        await c.env.DB.prepare(`UPDATE businesses SET status = 'past_due' WHERE id = ?1 AND plan_source = 'store'`).bind(businessId).run();
        break;
      default:
        break; // CANCELLATION / EXPIRATION / TRANSFER / TEST: access ends at plan_expires_at by itself
    }
    return c.json({ ok: true });
  });
}
