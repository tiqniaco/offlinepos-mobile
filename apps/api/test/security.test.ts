/**
 * Pre-launch security regressions: parallel-request races (OTP / password / OCR), SMS pumping caps, production-only
 * OTP rules, trial farming, and the step-up needed to take a shop over from another active phone.
 */
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@daftarak/shared';
import { makeClient, login, device, stepUp, BACKUP_KEY } from './helpers';
import { ConsoleProvider, providerFor, type OtpProvider } from '../src/otp/providers';
import { requestOtp, OTP_VERIFY_PER_PHONE_HOUR, OTP_WRONG_PER_PHONE_DAY } from '../src/otp/service';
import { cairoMonthStart, OCR_FAILED_PER_DAY, OCR_FALLBACK_PER_MONTH, OCR_MAX_CONCURRENT, type OcrClient } from '../src/ocr/scan';
import type { Env } from '../src/env';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const tally = (rs: { status: number; json: any }[]) => {
  const t: Record<string, number> = {};
  for (const r of rs) {
    const k = r.status === 200 || r.status === 201 ? 'OK' : r.json.error.code;
    t[k] = (t[k] ?? 0) + 1;
  }
  return t;
};
const wrongCodes = (real: string, n: number) => {
  const out: string[] = [];
  for (let i = 0; out.length < n; i++) {
    const g = String(i).padStart(6, '0');
    if (g !== real) out.push(g);
  }
  return out;
};

describe('OTP verify races and limits', () => {
  it('60 parallel wrong guesses: at most 5 are compared; the right code then fails', async () => {
    const c = makeClient();
    c.setIp('10.1.0.1');
    const phone = '01099990000';
    const r1 = await c.call('POST', '/v1/auth/otp/request', { phone });
    const real = ConsoleProvider.lastCodeFor(r1.json.phone)!;
    const res = await Promise.all(wrongCodes(real, 60).map((code) => c.call('POST', '/v1/auth/otp/verify', { phone, code, device: device() })));
    const t = tally(res);
    expect(t.OK).toBeUndefined();
    expect(t.otp_invalid ?? 0).toBeLessThanOrEqual(4);
    const row = await c.env.DB.prepare(`SELECT attempts FROM otp_codes WHERE phone = ?1`).bind(r1.json.phone).first<{ attempts: number }>();
    expect(row!.attempts).toBeLessThanOrEqual(5);
    c.setIp('10.1.0.2');
    const right = await c.call('POST', '/v1/auth/otp/verify', { phone, code: real, device: device() });
    expect(right.status).toBe(429);
    expect(right.json.error.code).toBe('otp_too_many_attempts');
  });

  it('60 wrong + the right code all in parallel: never more than 5 comparisons', async () => {
    const c = makeClient();
    c.setIp('10.1.1.1');
    const phone = '01099990001';
    const r1 = await c.call('POST', '/v1/auth/otp/request', { phone });
    const real = ConsoleProvider.lastCodeFor(r1.json.phone)!;
    const res = await Promise.all([...wrongCodes(real, 60), real].map((code) => c.call('POST', '/v1/auth/otp/verify', { phone, code, device: device() })));
    const t = tally(res);
    expect((t.OK ?? 0) + (t.otp_invalid ?? 0)).toBeLessThanOrEqual(5);
  });

  it('the right code used twice in parallel logs in only once', async () => {
    const c = makeClient();
    c.setIp('10.1.2.1');
    const phone = '01099990002';
    const r1 = await c.call('POST', '/v1/auth/otp/request', { phone });
    const real = ConsoleProvider.lastCodeFor(r1.json.phone)!;
    const res = await Promise.all([1, 2, 3].map(() => c.call('POST', '/v1/auth/otp/verify', { phone, code: real, device: device() })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
  });

  it(`per-phone verify cap (${OTP_VERIFY_PER_PHONE_HOUR}/h) holds across fresh codes`, async () => {
    const c = makeClient();
    c.setIp('10.1.3.1');
    const phone = '01099990003';
    const codes: string[] = [];
    for (let round = 0; round < 3; round++) {
      const r = await c.call('POST', '/v1/auth/otp/request', { phone });
      const real = ConsoleProvider.lastCodeFor(r.json.phone)!;
      for (const code of wrongCodes(real, 4)) codes.push((await c.call('POST', '/v1/auth/otp/verify', { phone, code, device: device() })).json.error.code);
      c.advance(61_000);
    }
    expect(codes.slice(0, OTP_VERIFY_PER_PHONE_HOUR).every((x) => x === 'otp_invalid')).toBe(true);
    expect(codes.slice(OTP_VERIFY_PER_PHONE_HOUR).every((x) => x === 'otp_too_many_attempts')).toBe(true);
  });

  it(`${OTP_WRONG_PER_PHONE_DAY} wrong codes in a day invalidate the phone's codes until tomorrow`, async () => {
    const c = makeClient();
    c.setIp('10.1.4.1');
    const phone = '01099990004';
    let last = '';
    for (let round = 0; round < OTP_WRONG_PER_PHONE_DAY / 5; round++) {
      const r = await c.call('POST', '/v1/auth/otp/request', { phone });
      const real = ConsoleProvider.lastCodeFor(r.json.phone)!;
      for (const code of wrongCodes(real, 5)) last = (await c.call('POST', '/v1/auth/otp/verify', { phone, code, device: device() })).json.error.code;
      c.advance(HOUR + 1000);
    }
    expect(last).toBe('otp_too_many_attempts');
    const r = await c.call('POST', '/v1/auth/otp/request', { phone });
    const real = ConsoleProvider.lastCodeFor(r.json.phone)!;
    const v = await c.call('POST', '/v1/auth/otp/verify', { phone, code: real, device: device() });
    expect(v.json.error.code).toBe('otp_too_many_attempts');
    c.advance(DAY);
    const r2 = await c.call('POST', '/v1/auth/otp/request', { phone });
    expect((await c.call('POST', '/v1/auth/otp/verify', { phone, code: ConsoleProvider.lastCodeFor(r2.json.phone)!, device: device() })).status).toBe(200);
  });

  it('step-up verify is guarded the same way', async () => {
    const c = makeClient();
    c.setIp('10.1.5.1');
    const a = await login(c, '01099990005');
    c.advance(61_000);
    await c.call('POST', '/v1/auth/step-up/request', {}, bearer(a.accessToken));
    const real = ConsoleProvider.lastCodeFor('201099990005')!;
    await Promise.all(wrongCodes(real, 30).map((code) => c.call('POST', '/v1/auth/step-up/verify', { code }, bearer(a.accessToken))));
    const r = await c.call('POST', '/v1/auth/step-up/verify', { code: real }, bearer(a.accessToken));
    expect(r.status).toBe(429);
  });
});

describe('OTP sending: production rules and SMS-pumping caps', () => {
  it('production ignores OTP_FIXED_CODE and refuses the console provider', async () => {
    const c = makeClient();
    const prodEnv = { ...c.env, ENVIRONMENT: 'production', OTP_PROVIDER: 'console', OTP_FIXED_CODE: '123456' } as Env;
    await requestOtp(prodEnv, new ConsoleProvider(false), { phone: '201099991000', purpose: 'login', ip: '10.2.0.1', locale: 'ar', now: c.clock.now });
    expect(ConsoleProvider.lastCodeFor('201099991000')).not.toBe('123456');
    const devEnv = { ...c.env, ENVIRONMENT: 'development', OTP_PROVIDER: 'console', OTP_FIXED_CODE: '123456' } as Env;
    await requestOtp(devEnv, new ConsoleProvider(false), { phone: '201099991001', purpose: 'login', ip: '10.2.0.1', locale: 'ar', now: c.clock.now });
    expect(ConsoleProvider.lastCodeFor('201099991001')).toBe('123456');
    expect(() => providerFor({ ...c.env, ENVIRONMENT: 'production', OTP_PROVIDER: 'console' } as Env)).toThrow(/not allowed in production/);
  });

  it('global daily SMS cap (OTP_DAILY_CAP)', async () => {
    const c = makeClient(1_800_000_000_000 + 30 * DAY, {}, { OTP_DAILY_CAP: '2' });
    c.setIp('10.2.1.1');
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01099991100' })).status).toBe(200);
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01199991101' })).status).toBe(200);
    const r = await c.call('POST', '/v1/auth/otp/request', { phone: '01299991102' });
    expect([r.status, r.json.error.code]).toEqual([429, 'otp_rate_limited']);
  });

  it('per number-range hourly cap (first 6 digits)', async () => {
    const c = makeClient(1_800_000_000_000 + 31 * DAY, {}, { OTP_PREFIX_HOURLY_CAP: '2' });
    c.setIp('10.2.2.1');
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01055550001' })).status).toBe(200);
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01055550002' })).status).toBe(200);
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01055550003' })).json.error.code).toBe('otp_rate_limited');
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01066550003' })).status).toBe(200);
  });

  it('a failed send does not start the cooldown or use the per-phone quota', async () => {
    const failing: OtpProvider = { name: 'down', send: async () => ({ ok: false, error: 'down' }) };
    const start = 1_800_000_000_000 + 32 * DAY;
    const bad = makeClient(start, { provider: () => failing });
    bad.setIp('10.2.3.1');
    expect((await bad.call('POST', '/v1/auth/otp/request', { phone: '01077770001' })).json.error.code).toBe('otp_send_failed');
    const good = makeClient(start);
    good.setIp('10.2.3.1');
    expect((await good.call('POST', '/v1/auth/otp/request', { phone: '01077770001' })).status).toBe(200);
  });

  it('parallel requests for one phone send one SMS', async () => {
    const c = makeClient(1_800_000_000_000 + 33 * DAY);
    c.setIp('10.2.4.1');
    const res = await Promise.all([1, 2, 3, 4, 5].map(() => c.call('POST', '/v1/auth/otp/request', { phone: '01077770002' })));
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
  });
});

describe('password login races and limits', () => {
  it('18 parallel wrong passwords + the right one: at most 5 checked, then the account is locked', async () => {
    const c = makeClient();
    c.setIp('10.3.0.1');
    const a = await login(c, '01099990010');
    await c.call('POST', '/v1/auth/password/set', { password: 'Str0ngPass!x' }, bearer(a.accessToken));
    const pw = [...Array.from({ length: 18 }, (_, i) => `wrong-${i}x`), 'Str0ngPass!x'];
    const res = await Promise.all(pw.map((password) => c.call('POST', '/v1/auth/password/login', { phone: '01099990010', password, device: device() })));
    const t = tally(res);
    expect((t.OK ?? 0) + (t.invalid_credentials ?? 0)).toBeLessThanOrEqual(5);
    const acc = await c.env.DB.prepare(`SELECT password_locked_until FROM accounts WHERE phone = '201099990010'`).first<{ password_locked_until: number | null }>();
    if (!t.OK) expect(acc!.password_locked_until).toBeGreaterThan(c.clock.now);
  });

  it('per-IP and per-phone hourly caps', async () => {
    const c = makeClient();
    c.setIp('10.3.1.1');
    let last: any;
    for (let i = 0; i < 31; i++) last = await c.call('POST', '/v1/auth/password/login', { phone: `0109999${String(i).padStart(4, '0')}`, password: 'Nope2026x', device: device() });
    expect([last.status, last.json.error.code]).toEqual([429, 'rate_limited']);
    c.setIp('10.3.1.2');
    for (let i = 0; i < 21; i++) {
      c.setIp(`10.3.2.${i}`);
      last = await c.call('POST', '/v1/auth/password/login', { phone: '01088887777', password: 'Nope2026x', device: device() });
    }
    expect(last.json.error.code).toBe('rate_limited');
  });

  it('changing the password with only the current one needs a step-up while the shop is active on another phone', async () => {
    const c = makeClient();
    c.setIp('10.3.3.1');
    const a = await login(c, '01099990011', 'install-a');
    await c.call('POST', '/v1/auth/password/set', { password: 'First2026x' }, bearer(a.accessToken));
    await c.call('POST', '/v1/businesses', { name: 'Shop', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device('install-a') }, bearer(a.accessToken));
    const b = (await c.call('POST', '/v1/auth/password/login', { phone: '01099990011', password: 'First2026x', device: device('install-b') })).json;
    const r = await c.call('POST', '/v1/auth/password/set', { password: 'Second2026x', currentPassword: 'First2026x' }, bearer(b.accessToken));
    expect(r.json.error.code).toBe('step_up_required');
    c.advance(61_000);
    await stepUp(c, b.accessToken, '201099990011');
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'Second2026x' }, bearer(b.accessToken))).status).toBe(200);
  });
});

describe('devices/attach takeover', () => {
  it('a password-only session cannot take the shop from the active phone; the same phone can re-attach', async () => {
    const c = makeClient();
    c.setIp('10.4.0.1');
    const a = await login(c, '01099990020', 'install-a');
    await c.call('POST', '/v1/auth/password/set', { password: 'Shop2026xx' }, bearer(a.accessToken));
    const biz = (await c.call('POST', '/v1/businesses', { name: 'Shop', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device('install-a') }, bearer(a.accessToken))).json;
    // re-attach on the active phone's own session: allowed
    expect((await c.call('POST', '/v1/devices/attach', { businessId: biz.business.id, device: device('install-a') }, bearer(a.accessToken))).status).toBe(200);
    const thief = (await c.call('POST', '/v1/auth/password/login', { phone: '01099990020', password: 'Shop2026xx', device: device('install-t') })).json;
    const r = await c.call('POST', '/v1/devices/attach', { businessId: biz.business.id, device: device('install-t') }, bearer(thief.accessToken));
    expect([r.status, r.json.error.code]).toEqual([403, 'step_up_required']);
  });
});

describe('trial farming', () => {
  it('first shop gets the trial, the second starts free, a third is refused', async () => {
    const c = makeClient();
    c.setIp('10.5.0.1');
    const a = await login(c, '01099990030');
    const mk = (n: string) => c.call('POST', '/v1/businesses', { name: n, country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, bearer(a.accessToken));
    const b1 = await mk('One');
    const b2 = await mk('Two');
    const b3 = await mk('Three');
    expect([b1.status, b2.status]).toEqual([201, 201]);
    const rows = await c.env.DB.prepare(`SELECT name, plan_code, status FROM businesses WHERE id IN (?1, ?2)`).bind(b1.json.business.id, b2.json.business.id).all<any>();
    const by = Object.fromEntries(rows.results.map((r: any) => [r.name, r]));
    expect(by.One).toMatchObject({ plan_code: 'pro', status: 'trial' });
    expect(by.Two).toMatchObject({ plan_code: 'free', status: 'active' });
    expect([b3.status, b3.json.error.code]).toEqual([403, 'business_limit_reached']);
  });
});

const GOOD = { supplierName: 'X', invoiceNo: '1', date: '2026-11-20', currency: 'EGP', lines: [{ name: 'سكر', qty: 1, unitPrice: 10, total: 10 }], subtotal: 10, discount: null, tax: null, total: 10 };
function slowClaude(reply: () => { stop?: string; json?: unknown } = () => ({})) {
  const sent: any[] = [];
  const client: OcrClient = {
    beta: {
      messages: {
        create: async (params: any) => {
          sent.push(params);
          await new Promise((r) => setTimeout(r, 40));
          const x = reply();
          return { model: params.model, stop_reason: x.stop ?? 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'text', text: JSON.stringify(x.json ?? GOOD) }] } as any;
        },
      },
    },
  };
  return { client, sent };
}
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6));

async function ocrShop(c: ReturnType<typeof makeClient>, phone: string, ip: string) {
  c.setIp(ip);
  const a = await login(c, phone, `inst-${phone}`);
  const b = await c.call('POST', '/v1/businesses', { name: 'Shop', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(`inst-${phone}`) }, bearer(a.accessToken));
  return { h: bearer(a.accessToken), businessId: b.json.business.id as string, accountId: a.account.id as string };
}

describe('invoice scan cost guards', () => {
  it('40 parallel scans: the slot is claimed before the model call (≤ 2 running, ≤ rate)', async () => {
    const fake = slowClaude();
    const c = makeClient(1_800_000_000_000, { ocrClient: () => fake.client });
    const s = await ocrShop(c, '01099990040', '10.6.0.1');
    const res = await Promise.all(Array.from({ length: 40 }, () => c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h)));
    const t = tally(res);
    expect(fake.sent.length).toBeLessThanOrEqual(OCR_MAX_CONCURRENT);
    expect(t.OK).toBe(fake.sent.length);
    expect(t.rate_limited).toBe(40 - fake.sent.length);
  });

  it('same X-Idempotency-Key returns the stored result without a new model call', async () => {
    const fake = slowClaude();
    const c = makeClient(1_800_000_000_000, { ocrClient: () => fake.client });
    const s = await ocrShop(c, '01099990041', '10.6.1.1');
    const h = { ...s.h, 'X-Idempotency-Key': 'scan-key-0001' };
    const r1 = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, h);
    const r2 = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, h);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect(r2.json).toEqual(r1.json);
    expect(fake.sent).toHaveLength(1);
    c.advance(11 * 60_000);
    const fresh = { ...bearer((await login(c, '01099990041', 'inst-01099990041')).accessToken), 'X-Idempotency-Key': 'scan-key-0001' };
    const r3 = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, fresh);
    expect(r3.json.used).toBe(2);
    expect(fake.sent).toHaveLength(2);
  });

  it('global daily cap (OCR_DAILY_SCAN_CAP) → 503 ocr_unavailable', async () => {
    const fake = slowClaude();
    const c = makeClient(1_800_000_000_000 + 40 * DAY, { ocrClient: () => fake.client }, { OCR_DAILY_SCAN_CAP: '1' });
    const s = await ocrShop(c, '01099990042', '10.6.2.1');
    expect((await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h)).status).toBe(200);
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect([r.status, r.json.error.code]).toEqual([503, 'ocr_unavailable']);
    expect(fake.sent).toHaveLength(1);
  });

  it('trial: no expensive retry; paid: retry until the monthly budget is used', async () => {
    const fake = slowClaude(() => ({ stop: 'refusal' }));
    const c = makeClient(1_800_000_000_000, { ocrClient: () => fake.client });
    const s = await ocrShop(c, '01099990043', '10.6.3.1');
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(r.json.error.code).toBe('ocr_failed');
    expect(fake.sent.map((x) => x.model)).toEqual(['claude-haiku-5-5']);

    await c.env.DB.prepare(`UPDATE businesses SET status = 'active', plan_expires_at = ?2 WHERE id = ?1`).bind(s.businessId, c.clock.now + 90 * DAY).run();
    c.advance(61_000);
    fake.sent.length = 0;
    await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, bearer((await login(c, '01099990043', 'inst-01099990043')).accessToken));
    expect(fake.sent.map((x) => x.model)).toEqual(['claude-haiku-5-5', 'claude-opus-5-5']);

    const month = cairoMonthStart(c.clock.now);
    await c.env.DB.batch(
      Array.from({ length: OCR_FALLBACK_PER_MONTH }, (_, i) =>
        c.env.DB.prepare(`INSERT INTO ocr_scans (id, business_id, account_id, created_at, status, fallback) VALUES (?1, ?2, ?3, ?4, 'ok', 1)`).bind(uuidv7(), s.businessId, s.accountId, month + 1000 + i),
      ),
    );
    c.advance(61_000);
    fake.sent.length = 0;
    await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, bearer((await login(c, '01099990043', 'inst-01099990043')).accessToken));
    expect(fake.sent.map((x) => x.model)).toEqual(['claude-haiku-5-5']);
  });

  it(`${OCR_FAILED_PER_DAY} failed scans a day stop further scans`, async () => {
    const fake = slowClaude();
    const c = makeClient(1_800_000_000_000, { ocrClient: () => fake.client });
    const s = await ocrShop(c, '01099990044', '10.6.4.1');
    await c.env.DB.batch(
      Array.from({ length: OCR_FAILED_PER_DAY }, (_, i) =>
        c.env.DB.prepare(`INSERT INTO ocr_scans (id, business_id, account_id, created_at, status) VALUES (?1, ?2, ?3, ?4, 'failed')`).bind(uuidv7(), s.businessId, s.accountId, c.clock.now - 2 * HOUR + i),
      ),
    );
    const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect([r.status, r.json.error.code]).toEqual([429, 'rate_limited']);
    expect(fake.sent).toHaveLength(0);
  });

  it('PDFs whose pages cannot be counted (object streams / no pages) are refused', async () => {
    const fake = slowClaude();
    const c = makeClient(1_800_000_000_000, { ocrClient: () => fake.client });
    const s = await ocrShop(c, '01099990045', '10.6.5.1');
    const objStm = btoa('%PDF-1.7\n1 0 obj << /Type /ObjStm /N 3 /First 10 >> stream\nxx\nendstream endobj\n%%EOF');
    const noPages = btoa('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF');
    for (const file of [objStm, noPages]) {
      const r = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, file, mediaType: 'application/pdf' }, s.h);
      expect([r.status, r.json.error.code]).toEqual([400, 'pdf_unsupported']);
    }
    expect(fake.sent).toHaveLength(0);
  });
});
