/**
 * Supplier purchase-invoice photo → structured lines (OCR via the Claude API). Paid plans only, monthly quota per plan
 * (`limits.ocr_month`, -1 = unlimited). Token-lean: the app sends a ~1280 px JPEG (~1.5k image tokens), one short
 * system prompt, no examples, structured output (JSON schema) so no prose is generated, effort low.
 *
 * Model strategy (owner decision): read with the cheap model first (OCR_MODEL, default Haiku 5.5); only when that read
 * fails — API error, refusal / max_tokens, invalid JSON, zero lines or totals that do not add up — retry once with
 * OCR_FALLBACK_MODEL (default Opus 5.5, with server-side refusal fallbacks), on paid plans only and at most
 * OCR_FALLBACK_PER_MONTH times per business. A scan counts once whatever the retries.
 *
 * Cost-abuse guards: the scan row is claimed ('pending') atomically before any model call (quota, rate, concurrency,
 * daily failed cap), a global daily cap (OCR_DAILY_SCAN_CAP), no SDK retries, a 100 s deadline, and X-Idempotency-Key.
 *
 * `mode: 'list'` reads any list of the shop's items instead (handwritten / printed stock list, a price list): lines of
 * {name, qty, unit, cost, price}, every field but the name nullable. Same quota, protections and model strategy; a
 * list has no totals, so only an unusable read (error / refusal / bad JSON / no lines) triggers the retry model.
 */
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { OCR_IMAGE_MAX_BYTES, OCR_MAX_LINES, OCR_PDF_MAX_PAGES, UNLIMITED, ocrScanRequestSchema, uuidv7, type OcrListResponse, type OcrScanMode, type OcrScanResponse } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, errorResponse } from '../lib/http';
import { requireSession } from '../auth/tokens';
import { ownedBusiness } from '../routes/phase6';
import { effectiveLimits } from '../licence/issue';
import { decodeImage } from '../billing/manual';
import type { Deps } from '../routes/v1';
import { bumpCounter } from '../otp/service';

export const DEFAULT_OCR_MODEL = 'claude-haiku-5-5';
export const DEFAULT_OCR_FALLBACK_MODEL = 'claude-opus-5-5';
export const OCR_RATE_PER_MINUTE = 10;
/** Scans of one business running at the same time. */
export const OCR_MAX_CONCURRENT = 2;
/** Failed scans per business per day (they cost model calls but not quota). */
export const OCR_FAILED_PER_DAY = 20;
/** Expensive retry-model calls per business per Cairo month (paid plans only; never on the trial). */
export const OCR_FALLBACK_PER_MONTH = 30;
/** Default for env OCR_DAILY_SCAN_CAP: all businesses together per UTC day (spend circuit breaker). */
export const OCR_DEFAULT_DAILY_CAP = 2000;
/** Whole request budget — below the app's 120 s timeout so it never pays for a reply nobody waits for. */
export const OCR_DEADLINE_MS = 100_000;
/** A 'pending' row older than this is a dead request (worker killed); it stops counting. */
const PENDING_STALE_MS = OCR_DEADLINE_MS + 50_000;
/** Same X-Idempotency-Key within this window returns the stored result without a new model call. */
export const OCR_IDEMPOTENCY_MS = 10 * 60_000;
const DAY = 86_400_000;

/** The slice of the SDK client we use; tests inject a fake (never the network). */
export interface OcrClient {
  beta: { messages: { create: (params: MessageCreateParamsNonStreaming, options?: { timeout?: number; maxRetries?: number }) => Promise<BetaMessage> } };
}
// No SDK retries (each retry is a paid call; our own fallback logic decides), and a hard per-request timeout.
export const defaultOcrClient = (env: Env): OcrClient | null =>
  env.ANTHROPIC_API_KEY ? (new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: OCR_DEADLINE_MS }) as unknown as OcrClient) : null;

// ≤ 60 words. English instructions; names are copied as written (Arabic stays Arabic).
export const OCR_SYSTEM =
  'You read photos of supplier purchase invoices from Egyptian shops. Extract the header and every item line. ' +
  'Copy supplier and item names exactly as written; keep Arabic in Arabic. Numbers are plain decimals in the invoice currency (usually EGP): ' +
  'qty is the count, unitPrice per unit, total per line. Date as YYYY-MM-DD. Use null for anything missing or unreadable.';

// ≤ 60 words.
export const OCR_LIST_SYSTEM =
  'You read photos of item lists from Egyptian shops: handwritten or printed stock lists, price lists, notebooks. ' +
  'Return every item line. Copy names exactly as written; keep Arabic in Arabic. qty is the count on hand, unit as written ' +
  '(e.g. كرتونة, علبة, كيلو), cost the buying price, price the selling price, plain decimals. Use null for anything missing.';

const num = { type: ['number', 'null'] } as const;
const str = { type: ['string', 'null'] } as const;
export const OCR_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplierName', 'invoiceNo', 'date', 'currency', 'lines', 'subtotal', 'discount', 'tax', 'total'],
  properties: {
    supplierName: str,
    invoiceNo: str,
    date: str,
    currency: str,
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'unit', 'unitPrice', 'total'],
        properties: { name: { type: 'string' }, qty: num, unit: str, unitPrice: num, total: num },
      },
    },
    subtotal: num,
    discount: num,
    tax: num,
    total: num,
  },
} as const;

export const OCR_LIST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lines'],
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'qty', 'unit', 'cost', 'price'],
        properties: { name: { type: 'string' }, qty: num, unit: str, cost: num, price: num },
      },
    },
  },
} as const;

const n = z.number().nullable();
const modelOutputSchema = z.object({
  supplierName: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(z.object({ name: z.string(), qty: n, unitPrice: n, total: n, unit: z.string().nullable().optional() })),
  subtotal: n,
  discount: n,
  tax: n,
  total: n,
});
export type OcrExtract = Omit<OcrScanResponse, 'used' | 'limit'>;

const MAX_QTY = 1_000_000;
const MAX_UNIT = 10_000_000;
const MAX_TOTAL = 100_000_000;
/** Money / qty sanity: finite, ≥ 0, below the cap, rounded (money to piasters, qty to 3 decimals). */
const sane = (v: number | null | undefined, max: number, dp: number): number | null =>
  v == null || !Number.isFinite(v) || v < 0 || v > max ? null : Math.round(v * 10 ** dp) / 10 ** dp;
const clip = (s: string | null | undefined, max: number): string | null => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const validDate = (s: string | null): string | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
};

/** Validates and clamps the model JSON. Returns null when it is not the expected shape. */
export function parseExtract(text: string): OcrExtract | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = modelOutputSchema.safeParse(raw);
  if (!r.success) return null;
  const o = r.data;
  const lines: OcrExtract['lines'] = [];
  for (const l of o.lines) {
    if (lines.length >= OCR_MAX_LINES) break;
    const name = clip(l.name, 120);
    if (!name) continue;
    let qty = sane(l.qty, MAX_QTY, 3);
    let unitPrice = sane(l.unitPrice, MAX_UNIT, 2);
    const total = sane(l.total, MAX_TOTAL, 2);
    if (!qty || qty <= 0) qty = unitPrice && total ? Math.round((total / unitPrice) * 1000) / 1000 || 1 : 1;
    if (unitPrice == null && total != null) unitPrice = Math.round((total / qty) * 100) / 100;
    const unit = clip(l.unit, 24);
    lines.push({ name, qty, unitPrice, total, ...(unit ? { unit } : {}) });
  }
  const cur = clip(o.currency, 8)?.toUpperCase() ?? null;
  return {
    supplierName: clip(o.supplierName, 120),
    invoiceNo: clip(o.invoiceNo, 60),
    date: validDate(o.date),
    currency: cur,
    lines,
    subtotal: sane(o.subtotal, MAX_TOTAL, 2),
    discount: sane(o.discount, MAX_TOTAL, 2),
    tax: sane(o.tax, MAX_TOTAL, 2),
    total: sane(o.total, MAX_TOTAL, 2),
  };
}

const listOutputSchema = z.object({ lines: z.array(z.object({ name: z.string(), qty: n, unit: z.string().nullable(), cost: n, price: n })) });
export type OcrListExtract = Omit<OcrListResponse, 'used' | 'limit'>;

/** Validates and clamps a list-mode model JSON. Returns null when it is not the expected shape. Missing numbers stay null. */
export function parseListExtract(text: string): OcrListExtract | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const r = listOutputSchema.safeParse(raw);
  if (!r.success) return null;
  const lines: OcrListExtract['lines'] = [];
  for (const l of r.data.lines) {
    if (lines.length >= OCR_MAX_LINES) break;
    const name = clip(l.name, 120);
    if (!name) continue;
    const qty = sane(l.qty, MAX_QTY, 3);
    lines.push({ name, qty: qty && qty > 0 ? qty : null, unit: clip(l.unit, 24), cost: sane(l.cost, MAX_UNIT, 2), price: sane(l.price, MAX_UNIT, 2) });
  }
  return { mode: 'list', lines };
}

/** Do the line totals add up to the invoice (±5 %)? True when there is nothing to compare. */
export function totalsConsistent(x: OcrExtract): boolean {
  const lineSum = x.lines.reduce((a, l) => a + (l.total ?? (l.unitPrice != null ? l.unitPrice * l.qty : 0)), 0);
  const targets = [x.subtotal, x.total, x.total != null ? x.total - (x.tax ?? 0) + (x.discount ?? 0) : null].filter((v): v is number => v != null && v > 0);
  if (!targets.length || lineSum <= 0) return true;
  return targets.some((t) => Math.abs(lineSum - t) <= t * 0.05);
}

type Outcome = 'ok' | 'inconsistent' | 'api_error' | 'refusal' | 'max_tokens' | 'invalid_json' | 'no_lines';
export interface OcrCall { model: string; in: number; out: number; outcome: Outcome }

export interface ScanUpload { contentType: 'image/jpeg' | 'image/png' | 'application/pdf'; base64: string; pages?: number }

/** PDF name tokens with their #xx hex escapes decoded (PDF 1.2+: "/O#62jStm" is the name "/ObjStm"). */
export function decodePdfNames(bin: string): string {
  return bin.replace(/\/[^\s/\[\]<>(){}%]*/g, (n) => (n.includes('#') ? n.replace(/#([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))) : n));
}

/** Decodes and checks the upload: JPEG / PNG magic bytes, or %PDF with at most OCR_PDF_MAX_PAGES pages. */
export function decodeScanUpload(b: { image?: string; file?: string; mediaType?: string }): ScanUpload {
  if (b.image || b.mediaType !== 'application/pdf') return decodeImage((b.image ?? b.file)!, OCR_IMAGE_MAX_BYTES, 'image_invalid');
  const b64 = b.file!.replace(/^data:[\w/+.-]+;base64,/, '').replace(/\s+/g, '');
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ApiError(400, 'image_invalid', 'file is not valid base64');
  }
  if (bin.length === 0 || bin.length > OCR_IMAGE_MAX_BYTES) throw new ApiError(400, 'pdf_too_large', 'file must be at most 1.5 MB');
  if (!bin.startsWith('%PDF-')) throw new ApiError(400, 'image_invalid', 'file is not a PDF');
  // Cheap page count: page objects are "/Type /Page" (not "/Pages"). Name tokens may hide letters as #xx escapes
  // ("/P#61ge" = "/Page"), so names are decoded first. Compressed object streams (/ObjStm) can hide pages and
  // encrypted files cannot be inspected: such PDFs (and any where no page is found) are refused — upload photos.
  const names = decodePdfNames(bin);
  if (/\/(ObjStm|Encrypt)/.test(names)) {
    throw new ApiError(400, 'pdf_unsupported', 'this PDF cannot be checked, upload photos of the pages instead');
  }
  const pages = (names.match(/\/Type\s*\/Page(?![^\s/\[\]<>(){}%])/g) ?? []).length;
  if (pages === 0) throw new ApiError(400, 'pdf_unsupported', 'this PDF cannot be checked, upload photos of the pages instead');
  if (pages > OCR_PDF_MAX_PAGES) throw new ApiError(400, 'pdf_too_large', `PDF must have at most ${OCR_PDF_MAX_PAGES} pages`);
  return { contentType: 'application/pdf', base64: b64, pages };
}

export function buildRequest(model: string, upload: Pick<ScanUpload, 'contentType' | 'base64'>, withFallbacks: boolean, mode: OcrScanMode = 'invoice'): MessageCreateParamsNonStreaming {
  const list = mode === 'list';
  return {
    model,
    max_tokens: 16000,
    system: list ? OCR_LIST_SYSTEM : OCR_SYSTEM,
    // Thinking is adaptive by default on these models; effort low keeps it short. No temperature (rejected).
    output_config: { effort: 'low', format: { type: 'json_schema', schema: (list ? OCR_LIST_JSON_SCHEMA : OCR_JSON_SCHEMA) as unknown as Record<string, unknown> } },
    messages: [
      {
        role: 'user',
        content: [
          upload.contentType === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: upload.base64 } }
            : { type: 'image', source: { type: 'base64', media_type: upload.contentType, data: upload.base64 } },
          { type: 'text', text: list ? 'Extract this list of items.' : 'Extract this purchase invoice.' },
        ],
      },
    ],
    // Server-side refusal fallback only on the Opus retry (Haiku has none; our own retry covers it).
    ...(withFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
}

type AnyExtract = OcrExtract | OcrListExtract;

async function readOnce<X extends AnyExtract>(client: OcrClient, model: string, img: ScanUpload, withFallbacks: boolean, timeoutMs: number, mode: OcrScanMode): Promise<{ call: OcrCall; extract: X | null }> {
  let msg: BetaMessage;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ocr deadline')), timeoutMs);
    });
    msg = await Promise.race([client.beta.messages.create(buildRequest(model, img, withFallbacks, mode), { timeout: timeoutMs, maxRetries: 0 }), deadline]);
  } catch (e) {
    console.warn('ocr: api error', model, e instanceof Anthropic.APIError ? e.status : (e as Error)?.message);
    return { call: { model, in: 0, out: 0, outcome: 'api_error' }, extract: null };
  }
  finally {
    clearTimeout(timer);
  }
  const base = { model: msg.model || model, in: msg.usage?.input_tokens ?? 0, out: msg.usage?.output_tokens ?? 0 };
  if (msg.stop_reason === 'refusal') return { call: { ...base, outcome: 'refusal' }, extract: null };
  if (msg.stop_reason === 'max_tokens') return { call: { ...base, outcome: 'max_tokens' }, extract: null };
  const text = msg.content.find((b) => b.type === 'text');
  const extract = (text && text.type === 'text' ? (mode === 'list' ? parseListExtract(text.text) : parseExtract(text.text)) : null) as X | null;
  if (!extract) return { call: { ...base, outcome: 'invalid_json' }, extract: null };
  if (!extract.lines.length) return { call: { ...base, outcome: 'no_lines' }, extract };
  // A list has no totals to check.
  const ok = mode === 'list' || totalsConsistent(extract as OcrExtract);
  return { call: { ...base, outcome: ok ? 'ok' : 'inconsistent' }, extract };
}

/**
 * Cheap model first, stronger model only when the first read is unusable AND the caller allows it (paid plan, monthly
 * fallback budget left) AND enough of the overall deadline remains.
 */
export async function extractInvoice<X extends AnyExtract = OcrExtract>(env: Env, client: OcrClient, img: ScanUpload, opts: { allowFallback?: boolean; deadlineMs?: number; mode?: OcrScanMode } = {}) {
  const calls: OcrCall[] = [];
  const mode = opts.mode ?? 'invoice';
  const end = Date.now() + (opts.deadlineMs ?? OCR_DEADLINE_MS);
  const first = await readOnce<X>(client, env.OCR_MODEL || DEFAULT_OCR_MODEL, img, false, Math.max(1, end - Date.now()), mode);
  calls.push(first.call);
  if (first.call.outcome === 'ok') return { calls, extract: first.extract!, model: first.call.model };
  const left = end - Date.now();
  if (opts.allowFallback === false || left < 20_000) {
    if (first.call.outcome === 'inconsistent') return { calls, extract: first.extract!, model: first.call.model };
    return { calls, extract: null, model: first.call.model, unavailable: first.call.outcome === 'api_error' };
  }
  const second = await readOnce<X>(client, env.OCR_FALLBACK_MODEL || DEFAULT_OCR_FALLBACK_MODEL, img, true, left, mode);
  calls.push(second.call);
  if (second.call.outcome === 'ok' || second.call.outcome === 'inconsistent') return { calls, extract: second.extract!, model: second.call.model };
  // The retry failed outright: a readable-but-inconsistent first read is still better than nothing (the user reviews it).
  if (first.call.outcome === 'inconsistent') return { calls, extract: first.extract!, model: first.call.model };
  return { calls, extract: null, model: second.call.model, unavailable: calls.every((c) => c.outcome === 'api_error') };
}

/** UTC ms of the first instant of the current calendar month in Cairo. */
export function cairoMonthStart(now: number): number {
  const parts = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, Number(x.value)]),
    ) as Record<string, number>;
    return p;
  };
  const offsetAt = (t: number) => {
    const p = parts(t);
    return Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!) - Math.floor(t / 1000) * 1000;
  };
  const p = parts(now);
  const naive = Date.UTC(p.year!, p.month! - 1, 1);
  let t = naive - offsetAt(naive);
  t = naive - offsetAt(t);
  return t;
}

async function usageOf(env: Env, businessId: string, now: number): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ocr_scans WHERE business_id = ?1 AND status = 'ok' AND created_at >= ?2`).bind(businessId, cairoMonthStart(now)).first<{ n: number }>();
  return r?.n ?? 0;
}

const IDEM_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Claims a scan slot atomically (one INSERT … SELECT … WHERE): the monthly quota counts 'ok' + live 'pending' rows,
 * the per-minute rate counts every row, at most OCR_MAX_CONCURRENT live 'pending' rows, at most OCR_FAILED_PER_DAY
 * failed rows in 24 h. On refusal, works out which limit was hit for the error.
 */
async function claimScan(env: Env, a: { id: string; businessId: string; accountId: string; idemKey: string | null; quota: number; now: number }) {
  const { now } = a;
  const month = cairoMonthStart(now);
  const fresh = now - PENDING_STALE_MS;
  const res = await env.DB.prepare(
    `INSERT INTO ocr_scans (id, business_id, account_id, created_at, status, idem_key)
     SELECT ?1, ?2, ?3, ?4, 'pending', ?5
     WHERE (SELECT COUNT(*) FROM ocr_scans WHERE business_id = ?2 AND created_at > ?4 - 60000) < ?6
       AND (?7 = -1 OR (SELECT COUNT(*) FROM ocr_scans WHERE business_id = ?2 AND created_at >= ?8 AND (status = 'ok' OR (status = 'pending' AND created_at > ?9))) < ?7)
       AND (SELECT COUNT(*) FROM ocr_scans WHERE business_id = ?2 AND status = 'pending' AND created_at > ?9) < ?10
       AND (SELECT COUNT(*) FROM ocr_scans WHERE business_id = ?2 AND status = 'failed' AND created_at > ?4 - ?11) < ?12`,
  )
    .bind(a.id, a.businessId, a.accountId, now, a.idemKey, OCR_RATE_PER_MINUTE, a.quota, month, fresh, OCR_MAX_CONCURRENT, DAY, OCR_FAILED_PER_DAY)
    .run();
  if (res.meta.changes === 1) return;
  const r = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN created_at > ?2 - 60000 THEN 1 ELSE 0 END) AS minute,
       MIN(CASE WHEN created_at > ?2 - 60000 THEN created_at END) AS oldest,
       SUM(CASE WHEN created_at >= ?3 AND (status = 'ok' OR (status = 'pending' AND created_at > ?4)) THEN 1 ELSE 0 END) AS used,
       SUM(CASE WHEN status = 'pending' AND created_at > ?4 THEN 1 ELSE 0 END) AS running,
       SUM(CASE WHEN status = 'failed' AND created_at > ?2 - ?5 THEN 1 ELSE 0 END) AS failed
     FROM ocr_scans WHERE business_id = ?1 AND created_at > MIN(?3, ?2 - ?5)`,
  )
    .bind(a.businessId, now, month, fresh, DAY)
    .first<{ minute: number | null; oldest: number | null; used: number | null; running: number | null; failed: number | null }>();
  if (a.quota !== UNLIMITED && (r?.used ?? 0) >= a.quota) throw new ApiError(402, 'ocr_quota_exceeded', `used ${r?.used ?? 0} of ${a.quota} scans this month`);
  if ((r?.running ?? 0) >= OCR_MAX_CONCURRENT) throw new ApiError(429, 'rate_limited', 'a scan is already running, wait for it', 10_000);
  if ((r?.failed ?? 0) >= OCR_FAILED_PER_DAY) throw new ApiError(429, 'rate_limited', 'too many unreadable scans today, try tomorrow', DAY);
  throw new ApiError(429, 'rate_limited', 'too many scans, wait a minute', Math.max(1000, (r?.oldest ?? now) + 60_000 - now));
}

/** Mounted under /v1 (Bearer session; the caller must own the business — the only account role on the server). */
export function addOcrRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.get('/purchases/scan/usage', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const business = await ownedBusiness(c.env, c.req.query('businessId') ?? '', s.aid);
    const { limits } = await effectiveLimits(c.env, business, now);
    return c.json({ used: await usageOf(c.env, business.id, now), limit: limits.ocr_month });
  });

  const limit = bodyLimit({
    maxSize: Math.ceil((OCR_IMAGE_MAX_BYTES * 4) / 3) + 16 * 1024,
    onError: (c) => errorResponse(c, new ApiError(413, 'image_invalid', 'image must be at most 1.5 MB')),
  });

  app.post('/purchases/scan', limit, async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, ocrScanRequestSchema);
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    const { limits } = await effectiveLimits(c.env, business, now);
    const quota = limits.ocr_month ?? 0;
    if (quota === 0) throw new ApiError(403, 'ocr_not_in_plan', 'invoice scanning is not in this plan');
    const img = decodeScanUpload(b);
    const mode: OcrScanMode = b.mode ?? 'invoice';

    // Retry of the same scan (app timeout / network drop): same key within 10 min → the stored result, no new charge.
    // The mode is part of the stored key: the same photo read as a list is a different scan.
    const rawKey = c.req.header('X-Idempotency-Key');
    const idemKey = rawKey && IDEM_RE.test(rawKey) ? (mode === 'list' ? `list:${rawKey}` : rawKey) : null;
    const replay = async () => {
      const prev = await c.env.DB.prepare(
        `SELECT status, result_json, created_at FROM ocr_scans WHERE business_id = ?1 AND idem_key = ?2 AND created_at > ?3 ORDER BY created_at DESC LIMIT 1`,
      )
        .bind(business.id, idemKey, now - OCR_IDEMPOTENCY_MS)
        .first<{ status: string; result_json: string | null; created_at: number }>();
      if (prev?.status === 'ok' && prev.result_json) {
        return c.json({ ...(JSON.parse(prev.result_json) as AnyExtract), used: await usageOf(c.env, business.id, now), limit: quota } satisfies OcrScanResponse | OcrListResponse);
      }
      if (prev?.status === 'pending' && prev.created_at > now - PENDING_STALE_MS) throw new ApiError(429, 'rate_limited', 'this scan is still running', 10_000);
      return null;
    };
    if (idemKey) {
      const r = await replay();
      if (r) return r;
    }

    const client = (deps.ocrClient ?? defaultOcrClient)(c.env);
    if (!client) throw new ApiError(503, 'ocr_unavailable', 'invoice scanning is not configured');

    const scanId = uuidv7(now);
    if (idemKey) {
      // (business, key) is unique: a dead row (failed, stale pending, outside the window) gives its key up first.
      await c.env.DB.prepare(
        `UPDATE ocr_scans SET idem_key = NULL WHERE business_id = ?1 AND idem_key = ?2
           AND (status = 'failed' OR created_at <= ?3 OR (status = 'pending' AND created_at <= ?4))`,
      )
        .bind(business.id, idemKey, now - OCR_IDEMPOTENCY_MS, now - PENDING_STALE_MS)
        .run();
    }
    try {
      await claimScan(c.env, { id: scanId, businessId: business.id, accountId: s.aid, idemKey, quota, now });
    } catch (e) {
      // A parallel request with the same key won the insert: answer like a retry (stored result / still running).
      if (idemKey && /UNIQUE/i.test(String((e as Error)?.message ?? e))) {
        const r = await replay();
        if (r) return r;
        throw new ApiError(429, 'rate_limited', 'this scan is still running', 10_000);
      }
      throw e;
    }
    // Global spend circuit breaker (all businesses, UTC day).
    const cap = Number(c.env.OCR_DAILY_SCAN_CAP) > 0 ? Math.floor(Number(c.env.OCR_DAILY_SCAN_CAP)) : OCR_DEFAULT_DAILY_CAP;
    if ((await bumpCounter(c.env.DB, 'ocr-global', DAY, now)) > cap) {
      await c.env.DB.prepare(`DELETE FROM ocr_scans WHERE id = ?1`).bind(scanId).run();
      console.error('ocr: global daily scan cap reached');
      throw new ApiError(503, 'ocr_unavailable', 'invoice scanning is paused for today, try again tomorrow');
    }

    let r: Awaited<ReturnType<typeof extractInvoice<AnyExtract>>>;
    try {
      // The expensive retry model only on paid plans (never the trial) and within its monthly budget.
      let allowFallback = business.status !== 'trial' && business.status !== 'suspended';
      if (allowFallback) {
        const fb = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ocr_scans WHERE business_id = ?1 AND fallback = 1 AND created_at >= ?2`)
          .bind(business.id, cairoMonthStart(now))
          .first<{ n: number }>();
        allowFallback = (fb?.n ?? 0) < OCR_FALLBACK_PER_MONTH;
      }
      r = await extractInvoice<AnyExtract>(c.env, client, img, { allowFallback, mode });
    } catch (e) {
      await c.env.DB.prepare(`UPDATE ocr_scans SET status = 'failed' WHERE id = ?1`).bind(scanId).run();
      throw e;
    }
    const ok = !!r.extract && r.extract.lines.length > 0;
    await c.env.DB.prepare(
      `UPDATE ocr_scans SET status = ?2, input_tokens = ?3, output_tokens = ?4, model = ?5, calls_json = ?6, result_json = ?7, fallback = ?8 WHERE id = ?1`,
    )
      .bind(
        scanId,
        ok ? 'ok' : 'failed',
        r.calls.reduce((a, x) => a + x.in, 0),
        r.calls.reduce((a, x) => a + x.out, 0),
        r.model,
        JSON.stringify(r.calls),
        ok ? JSON.stringify(r.extract) : null,
        r.calls.length > 1 ? 1 : 0,
      )
      .run();
    if (!ok) {
      if ('unavailable' in r && r.unavailable) throw new ApiError(503, 'ocr_unavailable', 'the reading service is not reachable, try again');
      throw new ApiError(422, 'ocr_failed', mode === 'list' ? 'could not read this list' : 'could not read this invoice');
    }
    return c.json({ ...r.extract!, used: await usageOf(c.env, business.id, now), limit: quota } satisfies OcrScanResponse | OcrListResponse);
  });
}
