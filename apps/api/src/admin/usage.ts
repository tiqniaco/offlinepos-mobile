/**
 * Super-admin «الاستهلاك»: usage vs the Cloudflare free tier (global), usage per shop, and per-shop limit overrides
 * (effective limit = override ?? plan limit). Mounted by adminRoutes; every route needs an admin session.
 */
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { FREE_PLAN_CODE, LIMIT_KEYS, type LimitKey } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body } from '../lib/http';
import { parseOverrides, pickLimits, planLimits, type BusinessRow, type PlanRow, type ServerLimits } from '../licence/issue';
import { CF_FREE, GLOBAL, METRICS, cairoDay, cairoDayMinus, cairoMonthFirst } from '../usage/meter';
import { cairoMonthStart } from '../ocr/scan';
import type { Deps } from '../routes/v1';

/** Estimated model prices, USD per million tokens (labelled as an estimate in the admin UI). */
export const OCR_PRICES = { haiku: { in: 0.1, out: 0.5 }, opus: { in: 4, out: 20 } } as const;

type Sums = Partial<Record<(typeof METRICS)[number], { count: number; bytes: number }>>;

export function ocrCostUsd(s: Sums): number {
  const v = (m: keyof Sums) => s[m]?.count ?? 0;
  const opusIn = v('ocr_opus_input_tokens');
  const opusOut = v('ocr_opus_output_tokens');
  const cheapIn = Math.max(0, v('ocr_input_tokens') - opusIn);
  const cheapOut = Math.max(0, v('ocr_output_tokens') - opusOut);
  return (cheapIn * OCR_PRICES.haiku.in + cheapOut * OCR_PRICES.haiku.out + opusIn * OCR_PRICES.opus.in + opusOut * OCR_PRICES.opus.out) / 1_000_000;
}

const level = (pct: number) => (pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok');
const pct = (used: number, max: number) => Math.round((used / max) * 1000) / 10;

function sumRows(rows: { metric: string; count: number; bytes: number }[]): Sums {
  const out: Sums = {};
  for (const r of rows) {
    const k = r.metric as keyof Sums;
    const v = out[k] ?? { count: 0, bytes: 0 };
    if (k === 'backup_bytes_stored') {
      // a gauge: the latest value wins (rows come oldest first)
      v.count = r.count;
      v.bytes = r.bytes;
    } else {
      v.count += r.count;
      v.bytes += r.bytes;
    }
    out[k] = v;
  }
  return out;
}

/** Global gauges vs the Cloudflare free tier for one Cairo day (today). */
export async function freeTierStatus(env: Env, now: number) {
  const today = cairoDay(now);
  const r = await env.DB.prepare(`SELECT metric, count, bytes FROM usage_daily WHERE business_id = '*' AND day = ?1`).bind(today).all<{ metric: string; count: number; bytes: number }>();
  const t = sumRows(r.results);
  const backups = await env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM backups`).first<{ n: number; bytes: number }>();
  const receipts = await env.DB.prepare(`SELECT COALESCE(SUM(bytes), 0) AS bytes FROM usage_daily WHERE business_id = '*' AND metric = 'receipt_uploads'`).first<{ bytes: number }>();
  const r2Bytes = (backups?.bytes ?? 0) + (receipts?.bytes ?? 0);
  const gauges = [
    { key: 'requests', label: 'Workers requests/day', used: t.api_requests?.count ?? 0, max: CF_FREE.requestsDay },
    { key: 'd1_writes', label: 'D1 rows written/day', used: t.d1_rows_written?.count ?? 0, max: CF_FREE.d1WritesDay },
    { key: 'd1_reads', label: 'D1 rows read/day', used: t.d1_rows_read?.count ?? 0, max: CF_FREE.d1ReadsDay },
    { key: 'r2_storage', label: 'R2 storage', used: r2Bytes, max: CF_FREE.r2Bytes },
  ].map((g) => ({ ...g, pct: pct(g.used, g.max), level: level(pct(g.used, g.max)) }));
  return { today, gauges, maxPct: Math.max(...gauges.map((g) => g.pct)), storage: { backupBytes: backups?.bytes ?? 0, backupCount: backups?.n ?? 0, receiptBytes: receipts?.bytes ?? 0, r2Bytes } };
}

const overridesSchema = z.object({
  limits: z.partialRecord(z.enum(LIMIT_KEYS), z.number().int().min(-1).max(1_000_000_000).nullable()),
  note: z.string().trim().max(200).optional(),
});

const SORTS: Record<string, string> = {
  requests: 'requests_today',
  sms: 'sms_today',
  ocr: 'ocr_month',
  backup: 'backup_bytes',
  receipts: 'receipts_month',
  devices: 'devices',
  name: 'name',
  plan: 'plan_code',
};

export function addUsageAdminRoutes(
  app: Hono<AppEnv>,
  deps: Deps,
  requireAdmin: (c: Context<AppEnv>, now: number) => Promise<string>,
  audit: (env: Env, adminId: string, action: string, target: string | null, details: unknown, now: number) => Promise<void>,
) {
  /** Global usage: today / 7 d / 30 d, daily series, free-tier gauges, OCR cost estimate, SMS, storage. */
  app.get('/usage', async (c) => {
    const now = deps.now();
    await requireAdmin(c, now);
    const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 30) | 0));
    const since = cairoDayMinus(now, days - 1);
    const r = await c.env.DB.prepare(`SELECT day, metric, count, bytes FROM usage_daily WHERE business_id = ?1 AND day >= ?2 ORDER BY day`)
      .bind(GLOBAL, Math.min(since, cairoDayMinus(now, 29)))
      .all<{ day: number; metric: string; count: number; bytes: number }>();
    const today = cairoDay(now);
    const d7 = cairoDayMinus(now, 6);
    const d30 = cairoDayMinus(now, 29);
    const totals = {
      today: sumRows(r.results.filter((x) => x.day === today)),
      d7: sumRows(r.results.filter((x) => x.day >= d7)),
      d30: sumRows(r.results.filter((x) => x.day >= d30)),
    };
    const series: Record<number, Record<string, number>> = {};
    for (const x of r.results) if (x.day >= since) (series[x.day] ??= {})[x.metric] = x.metric.endsWith('_bytes_stored') ? x.bytes : x.count;
    return c.json({
      days,
      free: CF_FREE,
      status: await freeTierStatus(c.env, now),
      totals,
      ocrCostUsd: { today: ocrCostUsd(totals.today), d7: ocrCostUsd(totals.d7), d30: ocrCostUsd(totals.d30) },
      prices: OCR_PRICES,
      series: Object.entries(series).map(([day, m]) => ({ day: Number(day), ...m })),
    });
  });

  /** Usage per shop (today / this month) with the effective limits, sortable. */
  app.get('/usage/businesses', async (c) => {
    const now = deps.now();
    await requireAdmin(c, now);
    const sort = SORTS[c.req.query('sort') ?? 'requests'] ?? 'requests_today';
    const dir = c.req.query('dir') === 'asc' ? 'ASC' : 'DESC';
    const q = (c.req.query('q') ?? '').trim();
    const today = cairoDay(now);
    const r = await c.env.DB.prepare(
      `SELECT * FROM (SELECT b.id, b.name, b.plan_code, b.status, b.plan_expires_at,
         COALESCE((SELECT count FROM usage_daily u WHERE u.business_id = b.id AND u.day = ?1 AND u.metric = 'api_requests'), 0) AS requests_today,
         COALESCE((SELECT count FROM usage_daily u WHERE u.business_id = b.id AND u.day = ?1 AND u.metric = 'otp_sms_sent'), 0) AS sms_today,
         (SELECT COUNT(*) FROM ocr_scans o WHERE o.business_id = b.id AND o.status = 'ok' AND o.created_at >= ?2) AS ocr_month,
         (SELECT COALESCE(SUM(size), 0) FROM backups k WHERE k.business_id = b.id AND k.committed_at IS NOT NULL) AS backup_bytes,
         COALESCE((SELECT SUM(count) FROM usage_daily u WHERE u.business_id = b.id AND u.day BETWEEN ?3 AND ?3 + 30 AND u.metric = 'receipt_uploads'), 0) AS receipts_month,
         (SELECT COUNT(*) FROM devices d WHERE d.business_id = b.id AND d.deactivated_at IS NULL) AS devices,
         (SELECT json_group_object(limit_key, value) FROM business_limit_overrides o WHERE o.business_id = b.id) AS overrides
       FROM businesses b WHERE (?4 = '' OR b.name LIKE ?5)) ORDER BY ${sort} ${dir}, id LIMIT 200`,
    )
      .bind(today, cairoMonthStart(now), cairoMonthFirst(now), q, `%${q}%`)
      .all<{
        id: string;
        name: string;
        plan_code: string;
        status: BusinessRow['status'];
        plan_expires_at: number;
        requests_today: number;
        sms_today: number;
        ocr_month: number;
        backup_bytes: number;
        receipts_month: number;
        devices: number;
        overrides: string | null;
      }>();
    const plans = new Map((await c.env.DB.prepare(`SELECT * FROM plans`).all<PlanRow>()).results.map((p) => [p.code, p]));
    const free = plans.get(FREE_PLAN_CODE)!;
    return c.json({
      businesses: r.results.map((b) => {
        const ov = parseOverrides(b.overrides ? (JSON.parse(b.overrides) as Record<string, number>) : null);
        const { plan, limits } = pickLimits(b, plans.get(b.plan_code) ?? free, free, ov, now);
        return {
          id: b.id,
          name: b.name,
          plan: b.plan_code,
          effectivePlan: plan,
          status: b.status,
          requestsToday: b.requests_today,
          smsToday: b.sms_today,
          ocrMonth: b.ocr_month,
          backupBytes: b.backup_bytes,
          receiptsMonth: b.receipts_month,
          devices: b.devices,
          limits,
          overridden: Object.keys(ov),
        };
      }),
    });
  });

  /** One shop: daily series + every limit (plan / override / effective) with what is used now. */
  app.get('/businesses/:id/usage', async (c) => {
    const now = deps.now();
    await requireAdmin(c, now);
    const id = c.req.param('id');
    const b = await c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(id).first<BusinessRow>();
    if (!b) throw new ApiError(404, 'not_found');
    const days = Math.min(90, Math.max(1, Number(c.req.query('days') ?? 30) | 0));
    const rows = await c.env.DB.prepare(`SELECT day, metric, count, bytes FROM usage_daily WHERE business_id = ?1 AND day >= ?2 ORDER BY day`)
      .bind(id, cairoDayMinus(now, days - 1))
      .all<{ day: number; metric: string; count: number; bytes: number }>();
    const series: Record<number, Record<string, number>> = {};
    for (const x of rows.results) (series[x.day] ??= {})[x.metric] = x.metric.endsWith('_bytes_stored') ? x.bytes : x.count;
    const plan = await c.env.DB.prepare(`SELECT * FROM plans WHERE code = ?1`).bind(b.plan_code).first<PlanRow>();
    const free = (await c.env.DB.prepare(`SELECT * FROM plans WHERE code = ?1`).bind(FREE_PLAN_CODE).first<PlanRow>())!;
    const ovRows = await c.env.DB.prepare(`SELECT limit_key, value, note, set_by, set_at FROM business_limit_overrides WHERE business_id = ?1`)
      .bind(id)
      .all<{ limit_key: string; value: number; note: string | null; set_by: string | null; set_at: number }>();
    const ov = parseOverrides(ovRows.results);
    const eff = pickLimits(b, plan ?? free, free, ov, now);
    const base = pickLimits(b, plan ?? free, free, {}, now).limits;
    const today = cairoDay(now);
    const todays = sumRows(rows.results.filter((x) => x.day === today));
    const q1 = async (sql: string, ...args: unknown[]) => (await c.env.DB.prepare(sql).bind(...args).first<{ n: number | null }>())?.n ?? 0;
    const used: Partial<Record<LimitKey, number>> = {
      api_requests_day: todays.api_requests?.count ?? 0,
      sms_day: todays.otp_sms_sent?.count ?? 0,
      ocr_month: await q1(`SELECT COUNT(*) AS n FROM ocr_scans WHERE business_id = ?1 AND status = 'ok' AND created_at >= ?2`, id, cairoMonthStart(now)),
      backup_storage_mb: Math.ceil((await q1(`SELECT COALESCE(SUM(size), 0) AS n FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL`, id)) / (1024 * 1024)),
      backups_kept: await q1(`SELECT COUNT(*) AS n FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL`, id),
      receipt_uploads_month: await q1(`SELECT SUM(count) AS n FROM usage_daily WHERE business_id = ?1 AND metric = 'receipt_uploads' AND day BETWEEN ?2 AND ?2 + 30`, id, cairoMonthFirst(now)),
      devices: await q1(`SELECT COUNT(*) AS n FROM devices WHERE business_id = ?1 AND deactivated_at IS NULL`, id),
    };
    const limits = LIMIT_KEYS.map((key) => {
      const o = ovRows.results.find((x) => x.limit_key === key);
      return { key, plan: base[key], override: o ? o.value : null, note: o?.note ?? null, setAt: o?.set_at ?? null, effective: (eff.limits as ServerLimits)[key], used: used[key] ?? null };
    });
    return c.json({
      business: { id: b.id, name: b.name, plan: b.plan_code, effectivePlan: eff.plan, status: b.status },
      days,
      series: Object.entries(series).map(([day, m]) => ({ day: Number(day), ...m })),
      limits,
      ocrCostUsd30: ocrCostUsd(sumRows(rows.results)),
      planDefaults: plan ? planLimits(plan) : null,
    });
  });

  /** Set / clear per-shop overrides: a number sets it (-1 = unlimited), null goes back to the plan value. */
  app.put('/businesses/:id/limits', async (c) => {
    const now = deps.now();
    const adminId = await requireAdmin(c, now);
    const id = c.req.param('id');
    const b = await body(c, overridesSchema);
    const biz = await c.env.DB.prepare(`SELECT id FROM businesses WHERE id = ?1`).bind(id).first();
    if (!biz) throw new ApiError(404, 'not_found');
    const stmts = Object.entries(b.limits).map(([key, value]) =>
      value == null
        ? c.env.DB.prepare(`DELETE FROM business_limit_overrides WHERE business_id = ?1 AND limit_key = ?2`).bind(id, key)
        : c.env.DB.prepare(
            `INSERT INTO business_limit_overrides (business_id, limit_key, value, note, set_by, set_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT (business_id, limit_key) DO UPDATE SET value = ?3, note = ?4, set_by = ?5, set_at = ?6`,
          ).bind(id, key, value, b.note ?? null, adminId, now),
    );
    if (stmts.length) await c.env.DB.batch(stmts);
    await audit(c.env, adminId, 'limits_override', id, b, now);
    return c.json({ ok: true });
  });
}
