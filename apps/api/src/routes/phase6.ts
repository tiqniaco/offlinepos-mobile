/**
 * Phase 6 endpoints: cloud backups (presigned R2), backup-key release (step-up), restore/activate on a new phone,
 * activation codes, RevenueCat webhook. Mounted under /v1 by v1Routes.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { DAY_MS, FREE_PLAN_CODE, attachDeviceSchema, backupUploadSchema, base64urlEncode, uuidv7 } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { safeEqual, unwrapSecret } from '../lib/crypto';
import { requireSession } from '../auth/tokens';
import { effectiveLimits, getPlan, loadOverrides, planLimits, type BusinessRow } from '../licence/issue';
import { limitReached, onBusinessAccess, setGauge, track } from '../usage/meter';
import { bumpCounter } from '../otp/service';
import { presign } from '../backups/r2';
import { activatePlan, planRank, storeEndStatement } from '../billing/activate';
import type { Deps } from './v1';
import { isKnownInstall, newDeviceAlert } from '../announce/announce';

type CheckIntegrity = (env: Env, input: z.infer<typeof attachDeviceSchema>['integrity'], action: 'signup' | 'activate' | 'checkin', now: number) => Promise<unknown>;
let checkIntegrityFn: CheckIntegrity = async () => undefined;
export function setIntegrityChecker(f: CheckIntegrity) {
  checkIntegrityFn = f;
}

type RegisterDevice = (env: Env, business: BusinessRow, sessionId: string, device: z.infer<typeof attachDeviceSchema>['device'], now: number) => Promise<{ deviceId: string }>;

export async function ownedBusiness(env: Env, businessId: string, accountId: string): Promise<BusinessRow> {
  const b = await env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1 AND owner_account_id = ?2`).bind(businessId, accountId).first<BusinessRow>();
  if (!b) throw new ApiError(404, 'not_found');
  // Usage: the request is this shop's; soft daily request limit (usage/meter.ts; /checkin & co. are exempt).
  await onBusinessAccess(env, b);
  return b;
}

const MB = 1024 * 1024;

/** Max backup file size per (effective) plan. Unknown paid plans get the basic cap. */
export const BACKUP_MAX_BYTES: Record<string, number> = { free: 50 * 1024 * 1024, basic: 300 * 1024 * 1024, pro: 1024 * 1024 * 1024 };
/**
 * Hard cap on COMMITTED backups per business (all devices together), per effective plan: count and total bytes.
 * Unknown paid plans get the basic cap.
 */
export const BACKUP_HARD_CAP: Record<string, { count: number; bytes: number }> = {
  free: { count: 3, bytes: 3 * 50 * 1024 * 1024 },
  basic: { count: 7, bytes: 7 * 300 * 1024 * 1024 },
  pro: { count: 30, bytes: 30 * 1024 * 1024 * 1024 },
};
/** Manual "backup now" uploads per business per UTC day (the daily automatic backup rides on the check-in). */
export const BACKUP_UPLOADS_PER_DAY = 6;
/** Uncommitted backup rows (and their R2 objects) older than this are garbage. */
export const UNCOMMITTED_TTL_MS = 2 * DAY_MS;

const totalCount = (json: string | null | undefined): number => {
  try {
    return Object.values(JSON.parse(json ?? '{}') as Record<string, number>).reduce((a, b) => a + (Number(b) || 0), 0);
  } catch {
    return 0;
  }
};

/** Deletes backup rows and their R2 objects (objects first: a row without an object is harmless, the reverse leaks storage). */
export async function deleteBackups(env: Env, rows: { id: string; r2_key: string }[]) {
  for (let i = 0; i < rows.length; i += 100) {
    const part = rows.slice(i, i + 100);
    await env.BACKUPS.delete(part.map((o) => o.r2_key));
    await env.DB.batch(part.map((o) => env.DB.prepare(`DELETE FROM backups WHERE id = ?1`).bind(o.id)));
  }
}

/** Create a pending backup row + presigned PUT. Used by /backups/upload-url and by check-in (backupMeta). */
export async function startBackup(env: Env, businessId: string, deviceId: string, meta: { size: number; sha256: string; counts: Record<string, number>; schemaVersion: number }, kind: 'auto' | 'manual', now: number) {
  const dev = await env.DB.prepare(`SELECT id, deactivated_at, role FROM devices WHERE id = ?1 AND business_id = ?2`).bind(deviceId, businessId).first<{ id: string; deactivated_at: number | null; role: string }>();
  if (!dev) throw new ApiError(404, 'not_found', 'device');
  if (dev.deactivated_at) throw new ApiError(403, 'device_deactivated');
  if (dev.role !== 'main') throw new ApiError(403, 'wrong_device_role');
  const business = await env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(businessId).first<BusinessRow>();
  if (!business) throw new ApiError(404, 'not_found');
  const { plan, limits } = await effectiveLimits(env, business, now);
  const max = BACKUP_MAX_BYTES[plan] ?? BACKUP_MAX_BYTES.basic!;
  if (meta.size > max) throw new ApiError(413, 'backup_too_large', `backup must be at most ${Math.round(max / 1024 / 1024)} MB on this plan`);
  // Cloud storage per shop (backup_storage_mb, override ?? plan; 0 = no cloud backup, -1 = unlimited). What the shop
  // would hold after this backup: this one + the newest backups the hard cap keeps beside it.
  const storageMb = limits.backup_storage_mb;
  if (storageMb !== -1) {
    const cap = BACKUP_HARD_CAP[plan] ?? BACKUP_HARD_CAP.basic!;
    const kept = await env.DB.prepare(
      `SELECT COALESCE(SUM(size), 0) AS kept, (SELECT COALESCE(SUM(size), 0) FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL) AS stored
       FROM (SELECT size FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL ORDER BY committed_at DESC LIMIT ?2)`,
    )
      .bind(businessId, Math.max(0, cap.count - 1))
      .first<{ kept: number; stored: number }>();
    const usedMb = Math.ceil((kept?.stored ?? 0) / MB);
    if (storageMb <= 0) throw limitReached('backup_storage_mb', 0, usedMb, 'cloud backup is not in this plan: use the backup folder on the phone', 403);
    if (meta.size + (kept?.kept ?? 0) > storageMb * MB) throw limitReached('backup_storage_mb', storageMb, usedMb, `cloud backup storage is limited to ${storageMb} MB`, 413);
  }
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

/**
 * Verify the uploaded object (exact size) and apply plan retention: keep the newest N per device.
 * Retention never prunes when the new backup holds far less data (< 50 % of the records) than the newest older
 * backup of the shop: a wiped / fresh phone must not push the real history out.
 */
export async function commitBackup(env: Env, backupId: string, businessId: string, now: number): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT * FROM backups WHERE id = ?1 AND business_id = ?2`)
    .bind(backupId, businessId)
    .first<{ r2_key: string; size: number; committed_at: number | null; device_id: string; counts_json: string }>();
  if (!row) throw new ApiError(404, 'not_found');
  if (row.committed_at) return true;
  const head = await env.BACKUPS.head(row.r2_key);
  if (!head || head.size !== row.size) throw new ApiError(409, 'backup_not_uploaded');
  await env.DB.prepare(`UPDATE backups SET committed_at = ?2 WHERE id = ?1`).bind(backupId, now).run();
  const biz = (await env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(businessId).first<BusinessRow>())!;
  const overrides = await loadOverrides(env, businessId);
  const keep = overrides.backups_kept ?? planLimits(await getPlan(env, biz.plan_code)).backups_kept;
  const prev = await env.DB.prepare(`SELECT counts_json FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL AND id != ?2 ORDER BY committed_at DESC LIMIT 1`)
    .bind(businessId, backupId)
    .first<{ counts_json: string }>();
  const shrunk = !!prev && totalCount(row.counts_json) < totalCount(prev.counts_json) * 0.5;
  if (keep > 0 && !shrunk) {
    const old = await env.DB.prepare(
      `SELECT id, r2_key FROM backups WHERE business_id = ?1 AND device_id = ?2 AND committed_at IS NOT NULL ORDER BY committed_at DESC LIMIT -1 OFFSET ?3`,
    )
      .bind(businessId, row.device_id, keep)
      .all<{ id: string; r2_key: string }>();
    if (old.results.length) await deleteBackups(env, old.results);
  }
  // Hard cap per business (all devices), whatever the retention / shrink rules decided: newest first, at most
  // `count` backups and `bytes` in total. The shrink guard may keep ONE extra older backup: the one holding the most
  // records (the real history a wiped phone must not push out).
  const { plan, limits } = await effectiveLimits(env, biz, now);
  const hard = BACKUP_HARD_CAP[plan] ?? BACKUP_HARD_CAP.basic!;
  // The shop's cloud storage limit (backup_storage_mb) tightens the byte cap; the new backup itself is always kept.
  const cap = { count: hard.count, bytes: limits.backup_storage_mb > 0 ? Math.min(hard.bytes, limits.backup_storage_mb * MB) : hard.bytes };
  const all = await env.DB.prepare(`SELECT id, r2_key, size, counts_json FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL ORDER BY committed_at DESC, id DESC`)
    .bind(businessId)
    .all<{ id: string; r2_key: string; size: number; counts_json: string }>();
  let guarded: string | null = null;
  if (shrunk) {
    let best = -1;
    for (const b of all.results) if (b.id !== backupId && totalCount(b.counts_json) > best) (best = totalCount(b.counts_json)), (guarded = b.id);
  }
  const drop: { id: string; r2_key: string }[] = [];
  let n = 0;
  let bytes = 0;
  for (const b of all.results) {
    if (b.id === guarded) continue;
    if (b.id === backupId || (n < cap.count && bytes + b.size <= cap.bytes)) {
      n++;
      bytes += b.size;
    } else drop.push(b);
  }
  if (drop.length) await deleteBackups(env, drop);
  // Uncommitted leftovers (row + object) older than the TTL are garbage.
  const stale = await env.DB.prepare(`SELECT id, r2_key FROM backups WHERE business_id = ?1 AND committed_at IS NULL AND created_at < ?2`)
    .bind(businessId, now - UNCOMMITTED_TTL_MS)
    .all<{ id: string; r2_key: string }>();
  if (stale.results.length) await deleteBackups(env, stale.results);
  // Usage: one upload of `size` bytes; the shop's stored total (gauge) after retention.
  track(businessId, 'backup_uploads', 1, row.size);
  const guardedSize = guarded ? (all.results.find((b) => b.id === guarded)?.size ?? 0) : 0;
  setGauge(businessId, 'backup_bytes_stored', n + (guarded ? 1 : 0), bytes + guardedSize);
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
    const n = await bumpCounter(c.env.DB, `backup-upload:${b.businessId}`, DAY_MS, now);
    if (n > BACKUP_UPLOADS_PER_DAY) throw new ApiError(429, 'rate_limited', 'too many backups today', DAY_MS - (now % DAY_MS));
    const put = await startBackup(c.env, b.businessId, b.deviceId, b.meta, b.kind, now);
    await countRequest(c.env, b.businessId, now);
    return c.json(put);
  });

  /** Commit right after the PUT finished (the app calls this immediately; the next check-in would also commit it). */
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
    const known = await isKnownInstall(c.env, business.id, b.device.installId);
    const registration = await registerDevice(c.env, business, s.sid, b.device, now);
    if (!known) await newDeviceAlert(c.env, business, { id: registration.deviceId, model: b.device.model, platform: b.device.platform }, now, deps.push);
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
   * Idempotent by event id: the business update and the "seen" row are written in ONE batch, so a failure leaves
   * the event unseen and RevenueCat's retry applies it.
   *  - purchases / renewals / product changes set the plan until the store expiry; paid manual time (activation
   *    code / manual payment / admin: manual_plan_code + manual_until) is kept apart and never lost;
   *  - billing issue → past_due; refund (CANCELLATION with cancel_reason CUSTOMER_SUPPORT) → the manual plan while it
   *    runs, else the free plan;
   *  - EXPIRATION ends a store plan (back to the manual plan while it runs); other cancellations keep access until expiry;
   *  - SANDBOX events are recorded but ignored unless REVENUECAT_ALLOW_SANDBOX = "1".
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
          new_product_id: z.string().nullish(),
          expiration_at_ms: z.number().nullish(),
          cancel_reason: z.string().nullish(),
          environment: z.string().nullish(),
        }).passthrough(),
      }).passthrough(),
    );
    const e = payload.event;
    const businessId = e.app_user_id ?? e.original_app_user_id ?? null;
    const seen = await c.env.DB.prepare(`SELECT id FROM billing_events WHERE id = ?1`).bind(e.id).first();
    if (seen) return c.json({ ok: true, duplicate: true });
    const productId = e.type === 'PRODUCT_CHANGE' && e.new_product_id ? e.new_product_id : e.product_id;
    const mapped = planFromProduct(productId);
    const markSeen = c.env.DB.prepare(`INSERT INTO billing_events (id, business_id, type, product_id, plan_code, expires_at, raw_json, received_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`).bind(
      e.id,
      businessId,
      e.type,
      productId ?? null,
      mapped?.plan ?? null,
      e.expiration_at_ms ?? null,
      JSON.stringify(payload),
      now,
    );
    const sandboxIgnored = (e.environment ?? '').toUpperCase() === 'SANDBOX' && c.env.REVENUECAT_ALLOW_SANDBOX !== '1';
    const biz = businessId
      ? await c.env.DB.prepare(`SELECT id, plan_code, plan_source, plan_expires_at, manual_plan_code, manual_until FROM businesses WHERE id = ?1`)
          .bind(businessId)
          .first<{ id: string; plan_code: string; plan_source: string; plan_expires_at: number; manual_plan_code: string | null; manual_until: number | null }>()
      : null;
    if (!biz || sandboxIgnored) {
      await markSeen.run();
      return c.json({ ok: true, ...(sandboxIgnored ? { ignored: 'sandbox' } : {}), ...(businessId && !biz ? { unknownBusiness: true } : {}) });
    }
    const updates: D1PreparedStatement[] = [];
    // The manual entitlement; a row whose plan came from a manual source without the columns (set before they
    // existed / by hand) counts its current plan as manual.
    const legacyManual = !biz.manual_plan_code && ['manual', 'code', 'admin'].includes(biz.plan_source) && biz.plan_code !== FREE_PLAN_CODE;
    const manualPlan = biz.manual_plan_code ?? (legacyManual ? biz.plan_code : null);
    const manualUntil = biz.manual_plan_code ? (biz.manual_until ?? 0) : legacyManual ? biz.plan_expires_at : 0;
    const manualRunning = !!manualPlan && manualUntil > now;
    switch (e.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
      case 'NON_RENEWING_PURCHASE':
        if (mapped && e.expiration_at_ms) {
          // The manual entitlement (manual_plan_code / manual_until) is kept apart and never shortened:
          //  - a higher store plan applies until the store expiry, then EXPIRATION falls back to the manual plan;
          //  - the same plan runs until the later of both dates;
          //  - a lower store plan does not replace a better manual plan that is still running.
          if (manualRunning && planRank(mapped.plan) < planRank(manualPlan)) break;
          const until = manualRunning && mapped.plan === manualPlan ? Math.max(manualUntil, e.expiration_at_ms) : e.expiration_at_ms;
          updates.push(
            c.env.DB.prepare(
              `UPDATE businesses SET plan_code = ?2, plan_expires_at = ?3, plan_source = 'store', billing_period = ?4,
                 manual_plan_code = COALESCE(?5, manual_plan_code), manual_until = COALESCE(?6, manual_until),
                 status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'active' END WHERE id = ?1`,
            ).bind(biz.id, mapped.plan, until, mapped.period, legacyManual ? manualPlan : null, legacyManual ? manualUntil : null),
          );
        }
        break;
      case 'BILLING_ISSUE':
        updates.push(c.env.DB.prepare(`UPDATE businesses SET status = 'past_due' WHERE id = ?1 AND plan_source = 'store' AND status != 'suspended'`).bind(biz.id));
        break;
      case 'CANCELLATION':
        // A refund (granted by store support) takes the paid store plan away now (back to the manual plan while it
        // runs, else free); a normal cancellation keeps it until expiry.
        if ((e.cancel_reason ?? '').toUpperCase() === 'CUSTOMER_SUPPORT') updates.push(storeEndStatement(c.env, biz.id, 'refund', now, now, FREE_PLAN_CODE));
        break;
      case 'EXPIRATION':
        updates.push(storeEndStatement(c.env, biz.id, 'expire', now, e.expiration_at_ms ?? now, FREE_PLAN_CODE));
        break;
      default:
        break; // TRANSFER / TEST / SUBSCRIPTION_PAUSED …: nothing to change
    }
    await c.env.DB.batch([...updates, markSeen]);
    return c.json({ ok: true });
  });
}
