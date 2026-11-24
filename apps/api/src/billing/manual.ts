/**
 * Manual payments (Egypt): the owner pays by InstaPay / Vodafone Cash, uploads the receipt photo, and a super admin
 * activates the plan by hand (within `pay_sla_hours`). Receipts live in R2 (BACKUPS) under receipts/<businessId>/…
 * and are only readable through the admin API.
 */
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { DAY_MS, RECEIPT_MAX_BYTES, createPaymentRequestSchema, normalizePhone, uuidv7 } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, errorResponse } from '../lib/http';
import { requireSession } from '../auth/tokens';
import { ownedBusiness } from '../routes/phase6';
import { effectiveLimits, type PlanRow } from '../licence/issue';
import { limitReached, track, usedThisMonth } from '../usage/meter';
import type { Deps } from '../routes/v1';

export const PAYMENT_DEFAULTS = { instapay: '01558858884', vodafoneCash: '01017686542', slaHours: 12 };
export const MAX_PENDING_PER_BUSINESS = 3;
export const MAX_REQUESTS_PER_DAY = 10;

export async function paymentSettings(env: Env): Promise<{ instapay: string; vodafoneCash: string; slaHours: number }> {
  const r = await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN ('pay_instapay', 'pay_vodafone_cash', 'pay_sla_hours')`).all<{ key: string; value: string }>();
  const m = Object.fromEntries(r.results.map((x) => [x.key, x.value]));
  const sla = Number(m.pay_sla_hours);
  return {
    instapay: m.pay_instapay || PAYMENT_DEFAULTS.instapay,
    vodafoneCash: m.pay_vodafone_cash || PAYMENT_DEFAULTS.vodafoneCash,
    slaHours: Number.isFinite(sla) && sla > 0 ? sla : PAYMENT_DEFAULTS.slaHours,
  };
}

/** Decodes a base64 JPEG/PNG and checks size + magic bytes. Throws 400 with `code` on failure. */
export function decodeImage(raw: string, maxBytes: number, code: 'receipt_invalid' | 'image_invalid', what = 'image'): { bytes: Uint8Array; ext: 'jpg' | 'png'; contentType: 'image/jpeg' | 'image/png'; base64: string } {
  const b64 = raw.replace(/^data:[\w/+.-]+;base64,/, '').replace(/\s+/g, '');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ApiError(400, code, `${what} is not valid base64`);
  }
  if (bin.length === 0 || bin.length > maxBytes) throw new ApiError(400, code, `${what} must be at most ${Math.round((maxBytes / 1024 / 1024) * 10) / 10} MB`);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, ext: 'jpg', contentType: 'image/jpeg', base64: b64 };
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, ext: 'png', contentType: 'image/png', base64: b64 };
  throw new ApiError(400, code, `${what} must be a JPEG or PNG image`);
}

/** Decodes the base64 receipt and checks size + magic bytes. Throws 400 receipt_invalid. */
export function decodeReceipt(raw: string) {
  return decodeImage(raw, RECEIPT_MAX_BYTES, 'receipt_invalid', 'receipt');
}

export const receiptContentType = (key: string) => (key.endsWith('.png') ? 'image/png' : 'image/jpeg');

/** Mounted under /v1 (Bearer session; the caller must own the business). */
export function addManualBillingRoutes(app: Hono<AppEnv>, deps: Deps, countRequest: (env: Env, businessId: string, now: number) => Promise<void>) {
  app.get('/billing/manual/info', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    await ownedBusiness(c.env, c.req.query('businessId') ?? '', s.aid);
    const cfg = await paymentSettings(c.env);
    const plans = await c.env.DB.prepare(`SELECT * FROM plans WHERE is_free = 0 AND active = 1 ORDER BY monthly_egp`).all<PlanRow>();
    return c.json({
      methods: [
        { id: 'instapay', number: cfg.instapay },
        { id: 'vodafone_cash', number: cfg.vodafoneCash },
      ],
      slaHours: cfg.slaHours,
      plans: plans.results.map((p) => ({
        code: p.code,
        nameAr: p.name_ar,
        nameEn: p.name_en,
        monthlyMinor: p.monthly_egp,
        yearlyMinor: p.yearly_egp,
        monthlySarMinor: p.monthly_sar,
        yearlySarMinor: p.yearly_sar,
        limits: JSON.parse(p.limits_json) as Record<string, number>,
        features: JSON.parse(p.features_json) as string[],
      })),
    });
  });

  // base64 inflates the 2 MB receipt to ~2.7 MB; cap the JSON body a little above that.
  const limit = bodyLimit({
    maxSize: Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 16 * 1024,
    onError: (c) => errorResponse(c, new ApiError(413, 'receipt_invalid', 'receipt must be at most 2 MB')),
  });

  app.post('/billing/manual/requests', limit, async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, createPaymentRequestSchema);
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    const e164 = normalizePhone(b.payerPhone, 'EG');
    if (!e164 || !e164.startsWith('20')) throw new ApiError(400, 'invalid_phone', 'payer phone must be an Egyptian mobile number');
    const payerPhone = '0' + e164.slice(2);
    const plan = await c.env.DB.prepare(`SELECT * FROM plans WHERE code = ?1 AND is_free = 0 AND active = 1`).bind(b.plan).first<PlanRow>();
    if (!plan) throw new ApiError(400, 'invalid_request', 'unknown plan');
    const amount = b.period === 'yearly' ? plan.yearly_egp : plan.monthly_egp;
    // Same idempotency key (one per upgrade-screen session) = the retry of a request whose answer was lost.
    const existing = async () =>
      b.idempotencyKey
        ? c.env.DB.prepare(`SELECT id, status, amount_minor, created_at FROM payment_requests WHERE business_id = ?1 AND idempotency_key = ?2`)
            .bind(business.id, b.idempotencyKey)
            .first<{ id: string; status: string; amount_minor: number; created_at: number }>()
        : null;
    const same = await existing();
    if (same) return c.json({ id: same.id, status: same.status, amountMinor: same.amount_minor, createdAt: same.created_at }, 200);
    const receipt = decodeReceipt(b.receipt);
    const receiptSha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', receipt.bytes as Uint8Array<ArrayBuffer>))].map((x) => x.toString(16).padStart(2, '0')).join('');

    const counts = await c.env.DB.prepare(
      `SELECT SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN created_at > ?2 THEN 1 ELSE 0 END) AS today, MIN(CASE WHEN created_at > ?2 THEN created_at END) AS oldest
       FROM payment_requests WHERE business_id = ?1`,
    )
      .bind(business.id, now - DAY_MS)
      .first<{ pending: number | null; today: number | null; oldest: number | null }>();
    if ((counts?.today ?? 0) >= MAX_REQUESTS_PER_DAY) throw new ApiError(429, 'rate_limited', 'too many payment requests today', (counts?.oldest ?? now) + DAY_MS - now);
    if ((counts?.pending ?? 0) >= MAX_PENDING_PER_BUSINESS) throw new ApiError(409, 'too_many_pending', 'wait for the pending requests to be reviewed');
    // Receipt uploads per shop per Cairo month (receipt_uploads_month, override ?? plan).
    const { limits } = await effectiveLimits(c.env, business, now);
    if (limits.receipt_uploads_month !== -1) {
      const used = await usedThisMonth(c.env, business.id, 'receipt_uploads', now);
      if (used >= limits.receipt_uploads_month) throw limitReached('receipt_uploads_month', limits.receipt_uploads_month, used, 'monthly receipt uploads limit reached');
    }

    const id = uuidv7(now);
    const key = `receipts/${business.id}/${id}.${receipt.ext}`;
    await c.env.BACKUPS.put(key, receipt.bytes, { httpMetadata: { contentType: receipt.contentType } });
    try {
      await c.env.DB.prepare(
        `INSERT INTO payment_requests (id, business_id, account_id, plan_code, period, amount_minor, currency, method, payer_phone, note, receipt_key, status, created_at, idempotency_key, receipt_sha256, reference)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'EGP', ?7, ?8, ?9, ?10, 'pending', ?11, ?12, ?13, ?14)`,
      )
        .bind(id, business.id, s.aid, plan.code, b.period, amount, b.method, payerPhone, b.note?.trim() || null, key, now, b.idempotencyKey ?? null, receiptSha, b.reference?.trim() || null)
        .run();
    } catch (e) {
      // Two concurrent sends with the same key: the loser answers with the winner's request.
      const won = await existing();
      if (!won) throw e;
      await c.env.BACKUPS.delete(key);
      return c.json({ id: won.id, status: won.status, amountMinor: won.amount_minor, createdAt: won.created_at }, 200);
    }
    track(business.id, 'receipt_uploads', 1, receipt.bytes.length);
    await countRequest(c.env, business.id, now);
    return c.json({ id, status: 'pending', amountMinor: amount, createdAt: now }, 201);
  });

  app.get('/billing/manual/requests', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const business = await ownedBusiness(c.env, c.req.query('businessId') ?? '', s.aid);
    const r = await c.env.DB.prepare(
      `SELECT id, plan_code, period, amount_minor, method, status, reject_reason, created_at, reviewed_at FROM payment_requests WHERE business_id = ?1 ORDER BY created_at DESC LIMIT 20`,
    )
      .bind(business.id)
      .all<{ id: string; plan_code: string; period: string; amount_minor: number; method: string; status: string; reject_reason: string | null; created_at: number; reviewed_at: number | null }>();
    return c.json({
      requests: r.results.map((x) => ({
        id: x.id,
        plan: x.plan_code,
        period: x.period,
        amountMinor: x.amount_minor,
        method: x.method,
        status: x.status,
        rejectReason: x.reject_reason,
        createdAt: x.created_at,
        reviewedAt: x.reviewed_at,
      })),
    });
  });
}
