/**
 * Supplier purchase-invoice photo → structured lines (OCR via the Claude API). Paid plans only, monthly quota per plan
 * (`limits.ocr_month`, -1 = unlimited). Token-lean: the app sends a ~1280 px JPEG (~1.5k image tokens), one short
 * system prompt, no examples, structured output (JSON schema) so no prose is generated, effort low.
 *
 * Model strategy (owner decision): read with the cheap model first (OCR_MODEL, default Haiku 5.5); only when that read
 * fails — API error, refusal / max_tokens, invalid JSON, zero lines or totals that do not add up — retry once with
 * OCR_FALLBACK_MODEL (default Opus 5.5, with server-side refusal fallbacks). A scan counts once whatever the retries.
 */
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { z } from 'zod';
import { OCR_IMAGE_MAX_BYTES, OCR_MAX_LINES, OCR_PDF_MAX_PAGES, UNLIMITED, ocrScanRequestSchema, uuidv7, type OcrScanResponse } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, errorResponse } from '../lib/http';
import { requireSession } from '../auth/tokens';
import { ownedBusiness } from '../routes/phase6';
import { effectiveLimits } from '../licence/issue';
import { decodeImage } from '../billing/manual';
import type { Deps } from '../routes/v1';

export const DEFAULT_OCR_MODEL = 'claude-haiku-5-5';
export const DEFAULT_OCR_FALLBACK_MODEL = 'claude-opus-5-5';
export const OCR_RATE_PER_MINUTE = 10;

/** The slice of the SDK client we use; tests inject a fake (never the network). */
export interface OcrClient {
  beta: { messages: { create: (params: MessageCreateParamsNonStreaming, options?: { timeout?: number }) => Promise<BetaMessage> } };
}
export const defaultOcrClient = (env: Env): OcrClient | null =>
  env.ANTHROPIC_API_KEY ? (new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 }) as unknown as OcrClient) : null;

// ≤ 60 words. English instructions; names are copied as written (Arabic stays Arabic).
export const OCR_SYSTEM =
  'You read photos of supplier purchase invoices from Egyptian shops. Extract the header and every item line. ' +
  'Copy supplier and item names exactly as written; keep Arabic in Arabic. Numbers are plain decimals in the invoice currency (usually EGP): ' +
  'qty is the count, unitPrice per unit, total per line. Date as YYYY-MM-DD. Use null for anything missing or unreadable.';

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
        required: ['name', 'qty', 'unitPrice', 'total'],
        properties: { name: { type: 'string' }, qty: num, unitPrice: num, total: num },
      },
    },
    subtotal: num,
    discount: num,
    tax: num,
    total: num,
  },
} as const;

const n = z.number().nullable();
const modelOutputSchema = z.object({
  supplierName: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string().nullable(),
  lines: z.array(z.object({ name: z.string(), qty: n, unitPrice: n, total: n })),
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
    lines.push({ name, qty, unitPrice, total });
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
  // Cheap page count: page objects are "/Type /Page" (not "/Pages"). Compressed object streams can hide them (0 → rely on size).
  const pages = (bin.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  if (pages > OCR_PDF_MAX_PAGES) throw new ApiError(400, 'pdf_too_large', `PDF must have at most ${OCR_PDF_MAX_PAGES} pages`);
  return { contentType: 'application/pdf', base64: b64, pages };
}

export function buildRequest(model: string, upload: Pick<ScanUpload, 'contentType' | 'base64'>, withFallbacks: boolean): MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: 4096,
    system: OCR_SYSTEM,
    // Thinking is adaptive by default on these models; effort low keeps it short. No temperature (rejected).
    output_config: { effort: 'low', format: { type: 'json_schema', schema: OCR_JSON_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: 'user',
        content: [
          upload.contentType === 'application/pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: upload.base64 } }
            : { type: 'image', source: { type: 'base64', media_type: upload.contentType, data: upload.base64 } },
          { type: 'text', text: 'Extract this purchase invoice.' },
        ],
      },
    ],
    // Server-side refusal fallback only on the Opus retry (Haiku has none; our own retry covers it).
    ...(withFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
}

async function readOnce(client: OcrClient, model: string, img: ScanUpload, withFallbacks: boolean): Promise<{ call: OcrCall; extract: OcrExtract | null }> {
  let msg: BetaMessage;
  try {
    msg = await client.beta.messages.create(buildRequest(model, img, withFallbacks));
  } catch (e) {
    console.warn('ocr: api error', model, e instanceof Anthropic.APIError ? e.status : (e as Error)?.message);
    return { call: { model, in: 0, out: 0, outcome: 'api_error' }, extract: null };
  }
  const base = { model: msg.model || model, in: msg.usage?.input_tokens ?? 0, out: msg.usage?.output_tokens ?? 0 };
  if (msg.stop_reason === 'refusal') return { call: { ...base, outcome: 'refusal' }, extract: null };
  if (msg.stop_reason === 'max_tokens') return { call: { ...base, outcome: 'max_tokens' }, extract: null };
  const text = msg.content.find((b) => b.type === 'text');
  const extract = text && text.type === 'text' ? parseExtract(text.text) : null;
  if (!extract) return { call: { ...base, outcome: 'invalid_json' }, extract: null };
  if (!extract.lines.length) return { call: { ...base, outcome: 'no_lines' }, extract };
  return { call: { ...base, outcome: totalsConsistent(extract) ? 'ok' : 'inconsistent' }, extract };
}

/** Cheap model first, stronger model only when the first read is unusable. */
export async function extractInvoice(env: Env, client: OcrClient, img: ScanUpload) {
  const calls: OcrCall[] = [];
  const first = await readOnce(client, env.OCR_MODEL || DEFAULT_OCR_MODEL, img, false);
  calls.push(first.call);
  if (first.call.outcome === 'ok') return { calls, extract: first.extract!, model: first.call.model };
  const second = await readOnce(client, env.OCR_FALLBACK_MODEL || DEFAULT_OCR_FALLBACK_MODEL, img, true);
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

    const recent = await c.env.DB.prepare(`SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM ocr_scans WHERE business_id = ?1 AND created_at > ?2`)
      .bind(business.id, now - 60_000)
      .first<{ n: number; oldest: number | null }>();
    if ((recent?.n ?? 0) >= OCR_RATE_PER_MINUTE) throw new ApiError(429, 'rate_limited', 'too many scans, wait a minute', (recent?.oldest ?? now) + 60_000 - now);
    const used = await usageOf(c.env, business.id, now);
    if (quota !== UNLIMITED && used >= quota) throw new ApiError(402, 'ocr_quota_exceeded', `used ${used} of ${quota} scans this month`);

    const client = (deps.ocrClient ?? defaultOcrClient)(c.env);
    if (!client) throw new ApiError(503, 'ocr_unavailable', 'invoice scanning is not configured');
    const r = await extractInvoice(c.env, client, img);
    const ok = !!r.extract && r.extract.lines.length > 0;
    await c.env.DB.prepare(
      `INSERT INTO ocr_scans (id, business_id, account_id, created_at, status, input_tokens, output_tokens, model, calls_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        uuidv7(now),
        business.id,
        s.aid,
        now,
        ok ? 'ok' : 'failed',
        r.calls.reduce((a, x) => a + x.in, 0),
        r.calls.reduce((a, x) => a + x.out, 0),
        r.model,
        JSON.stringify(r.calls),
      )
      .run();
    if (!ok) {
      if ('unavailable' in r && r.unavailable) throw new ApiError(503, 'ocr_unavailable', 'the reading service is not reachable, try again');
      throw new ApiError(422, 'ocr_failed', 'could not read this invoice');
    }
    return c.json({ ...r.extract!, used: used + 1, limit: quota } satisfies OcrScanResponse);
  });
}
