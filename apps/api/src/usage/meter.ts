/**
 * Usage metering (super-admin «الاستهلاك»): every consumable is counted in `usage_daily` per business and per Cairo
 * day, plus a global row (business_id '*'). Cheap by design:
 *  - a request-scoped tracker (AsyncLocalStorage) collects everything the request consumed, and ONE multi-row UPSERT
 *    writes it after the response (waitUntil in production);
 *  - D1 rows read / written by the request are measured on the way (a thin wrapper around env.DB) for the
 *    Cloudflare free-tier gauges;
 *  - metering never fails or blocks a request: every error is swallowed and logged.
 * The per-business soft request limit (api_requests_day) is checked when a handler loads the business
 * (routes/phase6.ts ownedBusiness → onBusinessAccess). /checkin, sign-in, device and billing routes are exempt so a
 * licence always renews and a shop can always pay.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MiddlewareHandler } from 'hono';
import { FREE_PLAN_CODE, UNLIMITED } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError } from '../lib/http';
import { parseOverrides, pickLimits, type BusinessRow, type ServerLimits } from '../licence/issue';

export const METRICS = [
  'api_requests',
  'checkins',
  'otp_sms_sent',
  'ocr_scans',
  'ocr_input_tokens',
  'ocr_output_tokens',
  'ocr_opus_calls',
  'ocr_opus_input_tokens',
  'ocr_opus_output_tokens',
  'backup_uploads',
  'backup_bytes_stored',
  'receipt_uploads',
  'announcements_delivered',
  'sync_events',
  'd1_rows_written',
  'd1_rows_read',
] as const;
export type Metric = (typeof METRICS)[number];
/** Gauges: the row holds the current total (set, not added). */
const GAUGES = new Set<Metric>(['backup_bytes_stored']);
export const GLOBAL = '*';

/** Cloudflare free plan (Workers 100k requests/day, D1 100k rows written/day, 5M rows read/day, R2 10 GB). */
export const CF_FREE = { requestsDay: 100_000, d1WritesDay: 100_000, d1ReadsDay: 5_000_000, r2Bytes: 10 * 1024 ** 3, d1Bytes: 5 * 1024 ** 3 } as const;

const cairoFmt = (() => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    return null;
  }
})();
/** Cairo calendar day as YYYYMMDD. */
export function cairoDay(now: number): number {
  const s = cairoFmt ? cairoFmt.format(new Date(now)) : new Date(now + 2 * 3_600_000).toISOString().slice(0, 10);
  return Number(s.replace(/-/g, ''));
}
/** First day (YYYYMM01) of the Cairo month. */
export const cairoMonthFirst = (now: number) => Math.floor(cairoDay(now) / 100) * 100 + 1;
/** YYYYMMDD of `n` days before the Cairo day of `now`. */
export function cairoDayMinus(now: number, n: number): number {
  return cairoDay(now - n * 86_400_000);
}

interface Tracker {
  now: number;
  businessId: string | null;
  /** key "<businessId>|<metric>" → count / bytes (business-scoped; the global row is derived). */
  adds: Map<string, { count: number; bytes: number }>;
  gauges: Map<string, { count: number; bytes: number }>;
  /** Global-only adds (no business). */
  globalAdds: Map<Metric, { count: number; bytes: number }>;
  d1: { written: number; read: number };
  gate: boolean;
  /** Count this as one api request (false for cron / direct writes). */
  request: boolean;
  gated: Set<string>;
  limits: Map<string, ServerLimits>;
}

const als = new AsyncLocalStorage<Tracker>();
const current = () => als.getStore();

const add = (m: Map<string, { count: number; bytes: number }>, k: string, count: number, bytes: number) => {
  const v = m.get(k) ?? { count: 0, bytes: 0 };
  v.count += count;
  v.bytes += bytes;
  m.set(k, v);
};

/** Count `count` / `bytes` of a metric for a business (and the global row). No-op outside a metered request. */
export function track(businessId: string | null | undefined, metric: Metric, count = 1, bytes = 0) {
  const t = current();
  if (!t) return;
  const c = Math.max(0, Math.trunc(count) || 0);
  const b = Math.max(0, Math.trunc(bytes) || 0);
  if (!c && !b) return;
  if (businessId) add(t.adds, `${businessId}|${metric}`, c, b);
  else add(t.globalAdds as Map<string, { count: number; bytes: number }>, metric, c, b);
}

/** Set a gauge (e.g. backup_bytes_stored = current total) for a business; the global gauge is recomputed. */
export function setGauge(businessId: string, metric: Metric, count: number, bytes: number) {
  const t = current();
  if (!t) return;
  t.gauges.set(`${businessId}|${metric}`, { count: Math.max(0, Math.trunc(count)), bytes: Math.max(0, Math.trunc(bytes)) });
}

/** The business this request works for (its api_requests are counted on it). */
export function meterBusiness(businessId: string) {
  const t = current();
  if (t && !t.businessId) t.businessId = businessId;
}

/** Cached effective limits of this request (filled by the request gate). */
export const cachedLimits = (businessId: string): ServerLimits | undefined => current()?.limits.get(businessId);
export const cacheLimits = (businessId: string, l: ServerLimits) => current()?.limits.set(businessId, l);

export function limitReached(key: string, limit: number, used: number, message?: string, status: 429 | 403 | 413 = 429): ApiError {
  return new ApiError(status, 'limit_reached', message ?? `${key}: used ${used} of ${limit}`, undefined, { key, limit, used });
}

/**
 * Called when a handler loads the shop it works for: marks the request as the shop's and applies the soft daily
 * request limit (one read: today's count + overrides + plan rows). Fails open: a metering error never blocks.
 */
export async function onBusinessAccess(env: Env, business: BusinessRow): Promise<void> {
  const t = current();
  if (!t) return;
  meterBusiness(business.id);
  if (!t.gate || t.gated.has(business.id)) return;
  t.gated.add(business.id);
  let used = 0;
  let limit = UNLIMITED;
  try {
    const r = await env.DB.prepare(
      `SELECT (SELECT count FROM usage_daily WHERE business_id = ?1 AND day = ?2 AND metric = 'api_requests') AS used,
              (SELECT json_group_object(limit_key, value) FROM business_limit_overrides WHERE business_id = ?1) AS ov,
              p.code AS p_code, p.is_free AS p_free, p.limits_json AS p_limits, f.code AS f_code, f.is_free AS f_free, f.limits_json AS f_limits
       FROM plans f LEFT JOIN plans p ON p.code = ?3 WHERE f.code = ?4`,
    )
      .bind(business.id, cairoDay(t.now), business.plan_code, FREE_PLAN_CODE)
      .first<{ used: number | null; ov: string | null; p_code: string | null; p_free: number; p_limits: string; f_code: string; f_free: number; f_limits: string }>();
    if (!r) return;
    const free = { code: r.f_code, is_free: r.f_free, limits_json: r.f_limits };
    const plan = r.p_code ? { code: r.p_code, is_free: r.p_free, limits_json: r.p_limits } : free;
    const { limits } = pickLimits(business, plan, free, parseOverrides(r.ov ? (JSON.parse(r.ov) as Record<string, number>) : null), t.now);
    cacheLimits(business.id, limits);
    used = r.used ?? 0;
    limit = limits.api_requests_day;
  } catch (e) {
    console.error('usage gate', e);
    return;
  }
  if (limit !== UNLIMITED && used >= limit) throw limitReached('api_requests_day', limit, used, 'daily request limit reached, try again tomorrow');
}

/** Today's (Cairo) count of a metric for a business, plus what this request already tracked. */
export async function usedToday(env: Env, businessId: string, metric: Metric, now: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT count FROM usage_daily WHERE business_id = ?1 AND day = ?2 AND metric = ?3`).bind(businessId, cairoDay(now), metric).first<{ count: number }>();
  return (r?.count ?? 0) + (current()?.adds.get(`${businessId}|${metric}`)?.count ?? 0);
}

/** This Cairo month's count of a metric for a business. */
export async function usedThisMonth(env: Env, businessId: string, metric: Metric, now: number): Promise<number> {
  const first = cairoMonthFirst(now);
  const r = await env.DB.prepare(`SELECT SUM(count) AS n FROM usage_daily WHERE business_id = ?1 AND metric = ?2 AND day BETWEEN ?3 AND ?4`)
    .bind(businessId, metric, first, first + 30)
    .first<{ n: number | null }>();
  return (r?.n ?? 0) + (current()?.adds.get(`${businessId}|${metric}`)?.count ?? 0);
}

const WRITE_SQL = /^\s*(insert|update|delete|replace)\b/i;
const REAL = new WeakMap<object, D1PreparedStatement>();

function wrapStatement(s: D1PreparedStatement, sql: string, t: Tracker): D1PreparedStatement {
  const write = WRITE_SQL.test(sql);
  const meter = (meta: D1Meta | undefined) => {
    t.d1.written += Number(meta?.rows_written ?? 0) || 0;
    t.d1.read += Number(meta?.rows_read ?? 0) || 0;
  };
  const w = new Proxy(s, {
    get(target, prop) {
      if (prop === 'bind') return (...args: unknown[]) => wrapStatement(target.bind(...args), sql, t);
      if (prop === 'run' || prop === 'all')
        return async (...args: unknown[]) => {
          const r = await (target[prop] as (...a: unknown[]) => Promise<D1Result>)(...args);
          meter(r?.meta);
          return r;
        };
      if (prop === 'first' || prop === 'raw')
        return async (...args: unknown[]) => {
          const r = await (target[prop] as (...a: unknown[]) => Promise<unknown>)(...args);
          // No meta on first() / raw(): a write statement counts as one row written, a read as one row read.
          if (write) t.d1.written += 1;
          else t.d1.read += 1;
          return r;
        };
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  REAL.set(w, s);
  return w;
}

function wrapDb(db: D1Database, t: Tracker): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql), sql, t);
      if (prop === 'batch')
        return async (stmts: D1PreparedStatement[]) => {
          const r = await target.batch(stmts.map((x) => REAL.get(x) ?? x));
          for (const x of r) {
            t.d1.written += Number(x?.meta?.rows_written ?? 0) || 0;
            t.d1.read += Number(x?.meta?.rows_read ?? 0) || 0;
          }
          return r;
        };
      const v = Reflect.get(target, prop, target) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** Builds the one UPSERT for everything a request consumed. Exported for tests. */
export function buildFlush(db: D1Database, t: Tracker): D1PreparedStatement | null {
  const day = cairoDay(t.now);
  const binds: unknown[] = [day];
  const idx = new Map<string, number>();
  const param = (id: string) => {
    if (!idx.has(id)) {
      binds.push(id);
      idx.set(id, binds.length);
    }
    return `?${idx.get(id)}`;
  };
  const rows: string[] = [];
  const known = new Set<string>(METRICS);
  const row = (biz: string, metric: string, count: number, bytes: number | string) => {
    if (!known.has(metric)) return;
    rows.push(`(${biz === GLOBAL ? `'*'` : param(biz)}, ?1, '${metric}', ${Math.trunc(count)}, ${typeof bytes === 'number' ? Math.trunc(bytes) : bytes})`);
  };
  const global = new Map<string, { count: number; bytes: number }>();
  // One request: on its shop (the global row is derived from it below) or, without a shop, globally only.
  if (t.request) {
    if (t.businessId) add(t.adds, `${t.businessId}|api_requests`, 1, 0);
    else add(global, 'api_requests', 1, 0);
  }
  for (const [k, v] of t.adds) {
    const [biz, metric] = k.split('|') as [string, string];
    row(biz, metric, v.count, v.bytes);
    add(global, metric, v.count, v.bytes);
  }
  for (const [k, v] of t.globalAdds) add(global, k, v.count, v.bytes);
  let backupGauge = false;
  for (const [k, v] of t.gauges) {
    const [biz, metric] = k.split('|') as [string, string];
    row(biz, metric, v.count, v.bytes);
    if (metric === 'backup_bytes_stored') backupGauge = true;
  }
  if (backupGauge) {
    rows.push(`('*', ?1, 'backup_bytes_stored', (SELECT COUNT(*) FROM backups WHERE committed_at IS NOT NULL), (SELECT COALESCE(SUM(size), 0) FROM backups WHERE committed_at IS NOT NULL))`);
  }
  for (const [k, v] of global) row(GLOBAL, k, v.count, v.bytes);
  if (t.d1.read) row(GLOBAL, 'd1_rows_read', t.d1.read, 0);
  // This UPSERT itself writes one row per value row (+ the d1_rows_written row).
  row(GLOBAL, 'd1_rows_written', t.d1.written + rows.length + 1, 0);
  if (binds.length > 90) return null; // never near D1's 100 bound-parameter cap (one business per request in practice)
  return db
    .prepare(
      `INSERT INTO usage_daily (business_id, day, metric, count, bytes) VALUES ${rows.join(', ')}
       ON CONFLICT (business_id, day, metric) DO UPDATE SET
         count = CASE WHEN excluded.metric IN (${[...GAUGES].map((g) => `'${g}'`).join(', ')}) THEN excluded.count ELSE usage_daily.count + excluded.count END,
         bytes = CASE WHEN excluded.metric IN (${[...GAUGES].map((g) => `'${g}'`).join(', ')}) THEN excluded.bytes ELSE usage_daily.bytes + excluded.bytes END`,
    )
    .bind(...binds);
}

/** Paths whose requests are never refused by the daily request limit (still counted). */
const GATE_EXEMPT = /^\/v1\/(checkin|auth\/|devices\/|businesses$|billing\/|licence\/|client-errors|webhooks\/)/;

/** Mounted on the whole app: meters every request (global api_requests) and whatever the handlers tracked. */
export function usageMiddleware(now: () => number): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const t: Tracker = {
      now: now(),
      businessId: null,
      adds: new Map(),
      gauges: new Map(),
      globalAdds: new Map(),
      d1: { written: 0, read: 0 },
      gate: c.req.path.startsWith('/v1/') && !GATE_EXEMPT.test(c.req.path),
      request: true,
      gated: new Set(),
      limits: new Map(),
    };
    const realDb = c.env?.DB;
    if (realDb) {
      try {
        c.env = { ...c.env, DB: wrapDb(realDb, t) };
      } catch {
        // metering is optional
      }
    }
    try {
      await als.run(t, () => next());
    } finally {
      if (realDb) {
        const p = (async () => {
          try {
            const stmt = buildFlush(realDb, t);
            if (stmt) await stmt.run();
          } catch (e) {
            console.error('usage meter', e);
          }
        })();
        let deferred = false;
        try {
          c.executionCtx.waitUntil(p);
          deferred = true;
        } catch {
          // no ExecutionContext (tests): finish before answering
        }
        if (!deferred) await p;
      }
    }
  };
}

/** For callers outside a metered request (e.g. cron): write metrics directly. Never throws. */
export async function meterDirect(env: Env, businessId: string | null, metrics: Partial<Record<Metric, number>>, now: number) {
  const t: Tracker = { now, businessId: null, adds: new Map(), gauges: new Map(), globalAdds: new Map(), d1: { written: 0, read: 0 }, gate: false, request: false, gated: new Set(), limits: new Map() };
  await als.run(t, async () => {
    for (const [m, n] of Object.entries(metrics)) track(businessId, m as Metric, n ?? 0);
  });
  try {
    const stmt = buildFlush(env.DB, t);
    if (stmt) await stmt.run();
  } catch (e) {
    console.error('usage meter', e);
  }
}
