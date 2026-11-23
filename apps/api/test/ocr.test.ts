import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@daftarak/shared';
import { makeClient, login, device, BACKUP_KEY } from './helpers';
import { cairoMonthStart, parseExtract, parseListExtract, totalsConsistent, OCR_SYSTEM, OCR_LIST_SYSTEM, OCR_LIST_JSON_SCHEMA, type OcrClient } from '../src/ocr/scan';

const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const GIF = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0]);
const pdf = (pages: number) => btoa(`%PDF-1.4\n1 0 obj << /Type /Pages /Count ${pages} >> endobj\n` + Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj << /Type /Page /Parent 1 0 R >> endobj\n`).join('') + '%%EOF');

const GOOD = {
  supplierName: 'شركة النور للتوريدات',
  invoiceNo: 'INV-77',
  date: '2026-11-20',
  currency: 'EGP',
  lines: [
    { name: 'سكر 1 كيلو', qty: 10, unitPrice: 30, total: 300 },
    { name: 'زيت عباد 800 مل', qty: 5, unitPrice: 70, total: 350 },
  ],
  subtotal: 650,
  discount: null,
  tax: null,
  total: 650,
};

type Reply = { model?: string; stop?: string; json?: unknown; text?: string; throws?: boolean; inTok?: number; outTok?: number };
function fakeClaude(replies: Reply[]) {
  const sent: any[] = [];
  const client: OcrClient = {
    beta: {
      messages: {
        create: async (params: any) => {
          sent.push(params);
          const r = replies.shift() ?? { json: GOOD };
          if (r.throws) throw new Error('boom');
          return {
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: params.model,
            content: [{ type: 'text', text: r.text ?? JSON.stringify(r.json ?? GOOD) }],
            stop_reason: r.stop ?? 'end_turn',
            usage: { input_tokens: r.inTok ?? 1600, output_tokens: r.outTok ?? 300 },
          } as any;
        },
      },
    },
  };
  return { client, sent };
}

async function shop(c: ReturnType<typeof makeClient>, phone: string) {
  const auth = await login(c, phone, `inst-${phone}`);
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  const r = await c.call('POST', '/v1/businesses', { name: 'محل الأمل', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(`inst-${phone}`) }, h);
  expect(r.status).toBe(201);
  return { h, businessId: r.json.business.id as string };
}

/** Paid (non-trial) plan: the only case where the expensive retry model may be used. */
async function paid(c: ReturnType<typeof makeClient>, businessId: string) {
  await c.env.DB.prepare(`UPDATE businesses SET status = 'active', plan_expires_at = ?2 WHERE id = ?1`).bind(businessId, c.clock.now + 90 * 86_400_000).run();
}

function setup(replies: Reply[] = []) {
  const fake = fakeClaude(replies);
  const c = makeClient(1_800_000_000_000, { ocrClient: () => fake.client });
  return { c, fake };
}

describe('invoice scan (OCR)', () => {
  it('trial (pro) scans with Haiku only; the request is lean; usage is counted', async () => {
    const { c, fake } = setup();
    const s = await shop(c, '01088888801');
    const u0 = await c.call('GET', `/v1/purchases/scan/usage?businessId=${s.businessId}`, undefined, s.h);
    expect(u0.json).toEqual({ used: 0, limit: 150 });

    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ supplierName: 'شركة النور للتوريدات', invoiceNo: 'INV-77', date: '2026-11-20', total: 650, used: 1, limit: 150 });
    expect(r.json.lines).toHaveLength(2);
    expect(fake.sent).toHaveLength(1);
    const p = fake.sent[0];
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.max_tokens).toBe(16000);
    expect(p.output_config.effort).toBe('low');
    expect(p.output_config.format.type).toBe('json_schema');
    expect(p.output_config.format.schema.additionalProperties).toBe(false);
    expect(p).not.toHaveProperty('thinking');
    expect(p).not.toHaveProperty('temperature');
    expect(p).not.toHaveProperty('fallbacks');
    expect(p).not.toHaveProperty('betas');
    expect(p.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: JPEG } });
    expect(OCR_SYSTEM.split(/\s+/).length).toBeLessThanOrEqual(60);

    const row = await c.env.DB.prepare(`SELECT * FROM ocr_scans WHERE business_id = ?1`).bind(s.businessId).first<any>();
    expect(row).toMatchObject({ status: 'ok', model: 'claude-haiku-5-5', input_tokens: 1600, output_tokens: 300 });
    const u1 = await c.call('GET', `/v1/purchases/scan/usage?businessId=${s.businessId}`, undefined, s.h);
    expect(u1.json).toEqual({ used: 1, limit: 150 });
  });

  it('paid plan: Haiku fails (refusal) → Opus retry with server-side fallbacks; counted once, both usages recorded', async () => {
    const { c, fake } = setup([{ stop: 'refusal', text: '', inTok: 1500, outTok: 5 }, { json: GOOD, inTok: 1700, outTok: 400 }]);
    const s = await shop(c, '01088888802');
    await paid(c, s.businessId);
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(200);
    expect(r.json.used).toBe(1);
    expect(fake.sent.map((x) => x.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect(fake.sent[1]).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    const rows = await c.env.DB.prepare(`SELECT * FROM ocr_scans WHERE business_id = ?1`).bind(s.businessId).all<any>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({ status: 'ok', model: 'claude-opus-5-5', input_tokens: 3200, output_tokens: 405 });
    expect(JSON.parse(rows.results[0].calls_json).map((x: any) => x.outcome)).toEqual(['refusal', 'ok']);
  });

  it('paid plan: Haiku inconsistent totals / bad JSON / API error each trigger the Opus retry', async () => {
    const bad = { ...GOOD, total: 5000, subtotal: 5000 };
    const firsts: Reply[] = [{ json: bad }, { text: 'not json' }, { throws: true }, { json: { ...GOOD, lines: [] } }, { stop: 'max_tokens' }];
    for (const [i, first] of firsts.entries()) {
      const { c, fake } = setup([first, { json: GOOD }]);
      const s = await shop(c, `0109999990${i}`);
      await paid(c, s.businessId);
      const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
      expect(r.status).toBe(200);
      expect(fake.sent.map((x) => x.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    }
  });

  it('both models refuse → 422 ocr_failed, not counted against the quota', async () => {
    const { c } = setup([{ stop: 'refusal', text: '' }, { stop: 'refusal', text: '' }]);
    const s = await shop(c, '01088888803');
    await paid(c, s.businessId);
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('ocr_failed');
    const u = await c.call('GET', `/v1/purchases/scan/usage?businessId=${s.businessId}`, undefined, s.h);
    expect(u.json.used).toBe(0);
    const row = await c.env.DB.prepare(`SELECT status FROM ocr_scans WHERE business_id = ?1`).bind(s.businessId).first<any>();
    expect(row.status).toBe('failed');
  });

  it('both calls error → 503 ocr_unavailable; missing API key → 503', async () => {
    const { c } = setup([{ throws: true }, { throws: true }]);
    const s = await shop(c, '01088888804');
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(503);
    expect(r.json.error.code).toBe('ocr_unavailable');

    const c2 = makeClient(1_800_000_000_000, { ocrClient: () => null });
    const s2 = await shop(c2, '01088888805');
    const r2 = await c2.call('POST', '/v1/purchases/scan', { businessId: s2.businessId, image: JPEG }, s2.h);
    expect(r2.json.error.code).toBe('ocr_unavailable');
  });

  it('free plan → 403 ocr_not_in_plan (no model call); expired trial falls to free', async () => {
    const { c, fake } = setup();
    const s = await shop(c, '01088888806');
    await c.env.DB.prepare(`UPDATE businesses SET plan_code = 'free', status = 'active' WHERE id = ?1`).bind(s.businessId).run();
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('ocr_not_in_plan');
    expect((await c.call('GET', `/v1/purchases/scan/usage?businessId=${s.businessId}`, undefined, s.h)).json).toEqual({ used: 0, limit: 0 });

    const s2 = await shop(c, '01088888807');
    c.advance(15 * 86_400_000); // 14-day trial is over
    const h2 = { Authorization: `Bearer ${(await login(c, '01088888807', 'inst-01088888807')).accessToken}` };
    const r2 = await c.call('POST', '/v1/purchases/scan', { businessId: s2.businessId, image: JPEG }, h2);
    expect(r2.json.error?.code).toBe('ocr_not_in_plan');
    expect(fake.sent).toHaveLength(0);
  });

  it('pro scans until the monthly limit, then 402 ocr_quota_exceeded; a new Cairo month resets it', async () => {
    const { c } = setup();
    const s = await shop(c, '01088888808');
    await c.env.DB.prepare(`UPDATE businesses SET status = 'active', plan_expires_at = ?2 WHERE id = ?1`).bind(s.businessId, c.clock.now + 90 * 86_400_000).run();
    const acc = (await c.env.DB.prepare(`SELECT owner_account_id AS a FROM businesses WHERE id = ?1`).bind(s.businessId).first<{ a: string }>())!.a;
    // 148 earlier successful scans this month (older than a minute, so no rate limit) + failed ones that don't count.
    const start = cairoMonthStart(c.clock.now);
    const stmts = Array.from({ length: 150 }, (_, i) =>
      c.env.DB.prepare(`INSERT INTO ocr_scans (id, business_id, account_id, created_at, status) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(uuidv7(), s.businessId, acc, start + 1000 + i, i < 148 ? 'ok' : 'failed'),
    );
    await c.env.DB.batch(stmts);
    for (const used of [149, 150]) {
      const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ used, limit: 150 });
    }
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(402);
    expect(r.json.error.code).toBe('ocr_quota_exceeded');
    c.advance(40 * 86_400_000);
    const h2 = { Authorization: `Bearer ${(await login(c, '01088888808', 'inst-01088888808')).accessToken}` };
    const next = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, h2);
    expect(next.status).toBe(200);
    expect(next.json.used).toBe(1);
  });

  it('rate limit: 10 scans per minute per business', async () => {
    const { c } = setup();
    const s = await shop(c, '01088888809');
    for (let i = 0; i < 10; i++) expect((await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h)).status).toBe(200);
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('rate_limited');
  });

  it('rejects invalid images, foreign businesses and missing auth', async () => {
    const { c, fake } = setup();
    const s = await shop(c, '01088888810');
    const other = await shop(c, '01088888811');
    const gif = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: GIF }, s.h);
    expect(gif.status).toBe(400);
    expect(gif.json.error.code).toBe('image_invalid');
    const junk = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: '!!!not base64!!!' }, s.h);
    expect(junk.json.error.code).toBe('image_invalid');
    const big = btoa(String.fromCharCode(0xff, 0xd8, 0xff) + 'x'.repeat(1.6 * 1024 * 1024));
    const tooBig = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: big }, s.h);
    expect([400, 413]).toContain(tooBig.status);
    const foreign = await c.call('POST', '/v1/purchases/scan', { businessId: other.businessId, image: JPEG }, s.h);
    expect(foreign.status).toBe(404);
    const anon = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG });
    expect(anon.status).toBe(401);
    expect(fake.sent).toHaveLength(0);
  });

  it('accepts a PDF (≤ 3 pages) as a document block; rejects bad or long PDFs', async () => {
    const { c, fake } = setup();
    const s = await shop(c, '01088888812');
    const ok = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, file: pdf(2), mediaType: 'application/pdf' }, s.h);
    expect(ok.status).toBe(200);
    expect(fake.sent[0].messages[0].content[0]).toMatchObject({ type: 'document', source: { type: 'base64', media_type: 'application/pdf' } });
    const long = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, file: pdf(4), mediaType: 'application/pdf' }, s.h);
    expect(long.status).toBe(400);
    expect(long.json.error.code).toBe('pdf_too_large');
    const notPdf = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, file: JPEG, mediaType: 'application/pdf' }, s.h);
    expect(notPdf.json.error.code).toBe('image_invalid');
    const both = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, file: JPEG, mediaType: 'image/jpeg' }, s.h);
    expect(both.json.error.code).toBe('invalid_request');
    expect(fake.sent).toHaveLength(1);
  });
});

describe('OCR parsing', () => {
  it('clamps names, line count and absurd numbers; validates dates', () => {
    const x = parseExtract(
      JSON.stringify({
        ...GOOD,
        date: '2026-02-30',
        supplierName: '  مورد   ',
        lines: [
          { name: 'ا'.repeat(300), qty: 2, unitPrice: 10, total: 20 },
          { name: '   ', qty: 1, unitPrice: 1, total: 1 },
          { name: 'صنف', qty: -5, unitPrice: 1e12, total: 40 },
          ...Array.from({ length: 150 }, (_, i) => ({ name: `صنف ${i}`, qty: 1, unitPrice: 1, total: 1 })),
        ],
        total: -3,
      }),
    )!;
    expect(x.date).toBeNull();
    expect(x.supplierName).toBe('مورد');
    expect(x.total).toBeNull();
    expect(x.lines).toHaveLength(100);
    expect(x.lines[0]!.name).toHaveLength(120);
    expect(x.lines[1]).toEqual({ name: 'صنف', qty: 1, unitPrice: 40, total: 40 });
    expect(parseExtract('{"lines":"x"}')).toBeNull();
    expect(parseExtract('nope')).toBeNull();
  });
  it('totals check allows ±5 %', () => {
    expect(totalsConsistent(parseExtract(JSON.stringify(GOOD))!)).toBe(true);
    expect(totalsConsistent(parseExtract(JSON.stringify({ ...GOOD, subtotal: 670, total: 670 }))!)).toBe(true);
    expect(totalsConsistent(parseExtract(JSON.stringify({ ...GOOD, subtotal: 900, total: 900 }))!)).toBe(false);
    expect(totalsConsistent(parseExtract(JSON.stringify({ ...GOOD, subtotal: null, total: null }))!)).toBe(true);
  });
  it('Cairo month start', () => {
    // 2026-11-23 12:00 UTC → 2026-11-01 00:00 Cairo (UTC+2 in winter) = 2026-10-31 22:00 UTC
    expect(new Date(cairoMonthStart(Date.UTC(2026, 10, 23, 12))).toISOString()).toBe('2026-10-31T22:00:00.000Z');
    // 2026-10-31 23:00 UTC is already November in Cairo
    expect(new Date(cairoMonthStart(Date.UTC(2026, 9, 31, 23))).toISOString()).toBe('2026-10-31T22:00:00.000Z');
  });
});

const LIST = {
  lines: [
    { name: 'شاي العروسة 250 جم', qty: 24, unit: 'علبة', cost: 18, price: 22 },
    { name: 'سكر', qty: 10, unit: 'كيلو', cost: null, price: null },
    { name: 'صابون لوكس', qty: null, unit: null, cost: null, price: 15 },
  ],
};

describe('item list scan (mode: list)', () => {
  it('reads a list with its own prompt + schema; nullable fields kept null; counted on the same monthly quota', async () => {
    const { c, fake } = setup([{ json: LIST }]);
    const s = await shop(c, '01077777701');
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, mode: 'list' }, s.h);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ mode: 'list', used: 1, limit: 150 });
    expect(r.json.lines).toEqual([
      { name: 'شاي العروسة 250 جم', qty: 24, unit: 'علبة', cost: 18, price: 22 },
      { name: 'سكر', qty: 10, unit: 'كيلو', cost: null, price: null },
      { name: 'صابون لوكس', qty: null, unit: null, cost: null, price: 15 },
    ]);
    const p = fake.sent[0];
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.system).toBe(OCR_LIST_SYSTEM);
    expect(OCR_LIST_SYSTEM.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(p.output_config.format.schema).toEqual(OCR_LIST_JSON_SCHEMA);
    expect(p.output_config.format.schema.properties.lines.items.required).toEqual(['name', 'qty', 'unit', 'cost', 'price']);
    expect(p.messages[0].content[1].text).toMatch(/list/);
    // An invoice scan afterwards uses the invoice schema and counts on the same quota.
    const inv = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(inv.status).toBe(200);
    expect(inv.json.used).toBe(2);
    expect(inv.json).not.toHaveProperty('mode');
    expect(fake.sent[1].system).toBe(OCR_SYSTEM);
    expect(fake.sent[1].output_config.format.schema.properties.lines.items.properties).toHaveProperty('unit');
  });

  it('list mode keeps the protections: free plan refused, quota exceeded → 402, failed read not counted', async () => {
    const { c, fake } = setup([{ json: { lines: [] } }, { json: { lines: [] } }]);
    const free = await shop(c, '01077777702');
    await c.env.DB.prepare(`UPDATE businesses SET plan_code = 'free', status = 'active' WHERE id = ?1`).bind(free.businessId).run();
    const r0 = await c.call('POST', '/v1/purchases/scan', { businessId: free.businessId, image: JPEG, mode: 'list' }, free.h);
    expect(r0.status).toBe(403);
    expect(r0.json.error.code).toBe('ocr_not_in_plan');
    expect(fake.sent).toHaveLength(0);

    const s = await shop(c, '01077777703');
    await paid(c, s.businessId);
    // No lines from both models → 422, not counted.
    const bad = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, mode: 'list' }, s.h);
    expect(bad.status).toBe(422);
    expect(bad.json.error.code).toBe('ocr_failed');
    expect(fake.sent.map((x) => x.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);
    expect((await c.call('GET', `/v1/purchases/scan/usage?businessId=${s.businessId}`, undefined, s.h)).json.used).toBe(0);

    const acc = (await c.env.DB.prepare(`SELECT owner_account_id AS a FROM businesses WHERE id = ?1`).bind(s.businessId).first<{ a: string }>())!.a;
    const start = cairoMonthStart(c.clock.now);
    await c.env.DB.batch(Array.from({ length: 150 }, (_, i) => c.env.DB.prepare(`INSERT INTO ocr_scans (id, business_id, account_id, created_at, status) VALUES (?1, ?2, ?3, ?4, 'ok')`).bind(uuidv7(), s.businessId, acc, start + 1000 + i)));
    const over = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, mode: 'list' }, s.h);
    expect(over.status).toBe(402);
    expect(over.json.error.code).toBe('ocr_quota_exceeded');
    const badMode = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, mode: 'menu' }, s.h);
    expect(badMode.json.error.code).toBe('invalid_request');
  });

  it('idempotency: same key + same mode → stored result (no new call); the same key in the other mode is a new scan', async () => {
    // A later clock: a fresh OTP-per-network window for this file's many logins.
    const fake = fakeClaude([{ json: LIST }, { json: GOOD }]);
    const c = makeClient(1_900_000_000_000, { ocrClient: () => fake.client });
    const s = await shop(c, '01077777704');
    const h = { ...s.h, 'X-Idempotency-Key': 'scan-abcdef123456' };
    const a = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, mode: 'list' }, h);
    const b = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG, mode: 'list' }, h);
    expect(a.status).toBe(200);
    expect(b.json).toEqual(a.json);
    expect(fake.sent).toHaveLength(1);
    const inv = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, h);
    expect(inv.status).toBe(200);
    expect(inv.json).toHaveProperty('supplierName');
    expect(fake.sent).toHaveLength(2);
  });

  it('parseListExtract clamps numbers, drops empty names and keeps missing values null', () => {
    const x = parseListExtract(JSON.stringify({ lines: [{ name: '  زيت  ', qty: -1, unit: '  ', cost: 1e12, price: 70.456 }, { name: ' ', qty: 1, unit: null, cost: 1, price: 1 }] }))!;
    expect(x.lines).toEqual([{ name: 'زيت', qty: null, unit: null, cost: null, price: 70.46 }]);
    expect(parseListExtract('{"lines":[{"name":"x"}]}')).toBeNull();
    expect(parseListExtract('nope')).toBeNull();
  });

  it('invoice lines carry the unit when the model reads one', () => {
    const x = parseExtract(JSON.stringify({ ...GOOD, lines: [{ name: 'شاي', qty: 2, unit: 'كرتونة', unitPrice: 400, total: 800 }] }))!;
    expect(x.lines[0]).toEqual({ name: 'شاي', qty: 2, unitPrice: 400, total: 800, unit: 'كرتونة' });
  });
});
