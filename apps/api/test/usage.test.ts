import { describe, expect, it } from 'vitest';
import { base32Encode, totpCode, uuidv7, verifyLicence, ed25519PublicKey } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { makeClient, login, device, BACKUP_KEY, TEST_PK_SK } from './helpers';
import { cairoDay, cairoMonthFirst } from '../src/usage/meter';
import { ocrCostUsd } from '../src/admin/usage';
import type { OcrClient } from '../src/ocr/scan';

type Client = ReturnType<typeof makeClient>;
const SHA = 'a'.repeat(64);
const MB = 1024 * 1024;
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const meta = (size: number) => ({ size, sha256: SHA, counts: { invoices: 10 }, schemaVersion: 11 });

async function shop(c: Client, phone: string) {
  const auth = await login(c, phone, `inst-${phone}`);
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  const r = await c.call('POST', '/v1/businesses', { name: 'محل', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(`inst-${phone}`) }, h);
  expect(r.status).toBe(201);
  return { h, auth, refresh: r.json.registration ? auth.refreshToken : '', businessId: r.json.business.id as string, deviceId: r.json.registration.deviceId as string };
}
const usage = async (c: Client, biz: string, metric: string) =>
  (await c.env.DB.prepare(`SELECT count, bytes FROM usage_daily WHERE business_id = ?1 AND day = ?2 AND metric = ?3`).bind(biz, cairoDay(c.clock.now), metric).first<{ count: number; bytes: number }>()) ?? { count: 0, bytes: 0 };
const override = (c: Client, biz: string, key: string, value: number) =>
  c.env.DB.prepare(
    `INSERT INTO business_limit_overrides (business_id, limit_key, value, set_at) VALUES (?1, ?2, ?3, 0) ON CONFLICT (business_id, limit_key) DO UPDATE SET value = ?3`,
  )
    .bind(biz, key, value)
    .run();
const setPlan = (c: Client, biz: string, plan: string) =>
  c.env.DB.prepare(`UPDATE businesses SET plan_code = ?2, status = 'active', plan_expires_at = ?3 WHERE id = ?1`).bind(biz, plan, c.clock.now + 90 * 86_400_000).run();

describe('usage metering', () => {
  it('cairoDay follows Cairo time (UTC+2/+3)', () => {
    expect(cairoDay(Date.UTC(2026, 10, 23, 21, 59))).toBe(20261123);
    expect(cairoDay(Date.UTC(2026, 10, 23, 22, 1))).toBe(20261124);
    expect(cairoMonthFirst(Date.UTC(2026, 10, 23, 12))).toBe(20261101);
  });

  it('counts requests, check-ins and D1 writes per shop and globally', async () => {
    const c = makeClient();
    const s = await shop(c, '01077770001');
    const g0 = await usage(c, '*', 'api_requests');
    const r = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r.status).toBe(200);
    expect((await usage(c, s.businessId, 'checkins')).count).toBe(1);
    expect((await usage(c, '*', 'checkins')).count).toBeGreaterThanOrEqual(1);
    expect((await usage(c, s.businessId, 'api_requests')).count).toBe(2); // sign-up + check-in
    expect((await usage(c, '*', 'api_requests')).count).toBe(g0.count + 1);
    expect((await usage(c, '*', 'd1_rows_written')).count).toBeGreaterThan(0);
    expect((await usage(c, '*', 'd1_rows_read')).count).toBeGreaterThan(0);
  });

  it('a metering failure never fails the request (and the request gate fails open)', async () => {
    const c = makeClient();
    const s = await shop(c, '01077770002');
    await c.env.DB.prepare(`ALTER TABLE usage_daily RENAME TO usage_daily_off`).run();
    try {
      const r = await c.call('GET', `/v1/backups?businessId=${s.businessId}`, undefined, s.h);
      expect(r.status).toBe(200);
      const ck = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
      expect(ck.status).toBe(200);
    } finally {
      await c.env.DB.prepare(`ALTER TABLE usage_daily_off RENAME TO usage_daily`).run();
    }
  });

  it('OCR tokens, Opus calls and scans are metered; the estimated cost uses Haiku / Opus prices', async () => {
    const fake: OcrClient = {
      beta: {
        messages: {
          create: async (p: any) =>
            ({
              id: 'm',
              type: 'message',
              role: 'assistant',
              model: p.model,
              content: [{ type: 'text', text: JSON.stringify({ supplierName: 'x', invoiceNo: null, date: null, currency: 'EGP', lines: [{ name: 'سكر', qty: 1, unitPrice: 10, total: 10 }], subtotal: 10, discount: null, tax: null, total: 10 }) }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 1000, output_tokens: 200 },
            }) as any,
        },
      },
    };
    const c = makeClient(1_800_000_000_000, { ocrClient: () => fake });
    const s = await shop(c, '01077770003');
    // Override precedence: the plan allows 150 scans, the override 1.
    await override(c, s.businessId, 'ocr_month', 1);
    expect((await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h)).status).toBe(200);
    expect((await usage(c, s.businessId, 'ocr_scans')).count).toBe(1);
    expect((await usage(c, s.businessId, 'ocr_input_tokens')).count).toBe(1000);
    expect((await usage(c, s.businessId, 'ocr_output_tokens')).count).toBe(200);
    c.advance(61_000);
    const second = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, s.h);
    expect(second.status).toBe(402);
    expect(ocrCostUsd({ ocr_input_tokens: { count: 2_000_000, bytes: 0 }, ocr_output_tokens: { count: 1_000_000, bytes: 0 }, ocr_opus_input_tokens: { count: 1_000_000, bytes: 0 }, ocr_opus_output_tokens: { count: 500_000, bytes: 0 } })).toBeCloseTo(0.1 + 0.25 + 4 + 10, 5);
  });
});

describe('per-shop limits (override ?? plan)', () => {
  it('sms_day: the shop’s SMS per Cairo day; the override wins over the plan', async () => {
    const c = makeClient();
    const s = await shop(c, '01077770010');
    await override(c, s.businessId, 'sms_day', 1);
    c.advance(61_000); // the sign-in code's resend cooldown
    expect((await c.call('POST', '/v1/auth/step-up/request', {}, s.h)).status).toBe(200);
    expect((await usage(c, s.businessId, 'otp_sms_sent')).count).toBe(1);
    c.advance(61_000);
    const r = await c.call('POST', '/v1/auth/step-up/request', {}, s.h);
    expect(r.status).toBe(429);
    expect(r.json.error).toMatchObject({ code: 'limit_reached', key: 'sms_day', limit: 1, used: 1 });
    // The login code of this phone counts on the same shop.
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01077770010' })).json.error.code).toBe('limit_reached');
    // Override removed → the plan value (trial = pro, 20/day).
    await c.env.DB.prepare(`DELETE FROM business_limit_overrides WHERE business_id = ?1`).bind(s.businessId).run();
    c.advance(61_000);
    expect((await c.call('POST', '/v1/auth/step-up/request', {}, s.h)).status).toBe(200);
  });

  it('backup_storage_mb: free = no cloud backup; an override allows it within the MB; check-in never fails', async () => {
    const c = makeClient();
    const s = await shop(c, '01077770011');
    await setPlan(c, s.businessId, 'free');
    const r = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(1000) }, s.h);
    expect(r.status).toBe(403);
    expect(r.json.error).toMatchObject({ code: 'limit_reached', key: 'backup_storage_mb', limit: 0 });
    const ck = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, backupMeta: meta(1000) });
    expect(ck.status).toBe(200);
    expect(ck.json.backupPut).toBeNull();
    expect(ck.json.backupError).toBe('limit_reached');
    // Override 1 MB: a 2 MB backup does not fit, a small one does; the stored gauge follows the commit.
    await override(c, s.businessId, 'backup_storage_mb', 1);
    const big = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(2 * MB) }, s.h);
    expect(big.status).toBe(413);
    expect(big.json.error).toMatchObject({ code: 'limit_reached', key: 'backup_storage_mb', limit: 1 });
    const ok = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(5) }, s.h);
    expect(ok.status).toBe(200);
    await c.env.BACKUPS.put(new URL(ok.json.url).pathname.split('/').slice(2).join('/'), 'x'.repeat(5));
    expect((await c.call('POST', `/v1/backups/${ok.json.backupId}/commit`, { businessId: s.businessId }, s.h)).status).toBe(200);
    expect(await usage(c, s.businessId, 'backup_bytes_stored')).toEqual({ count: 1, bytes: 5 });
    expect(await usage(c, s.businessId, 'backup_uploads')).toEqual({ count: 1, bytes: 5 });
    expect((await usage(c, '*', 'backup_bytes_stored')).bytes).toBeGreaterThanOrEqual(5);
  });

  it('receipt_uploads_month: per Cairo month, override first', async () => {
    const c = makeClient();
    const s = await shop(c, '01077770012');
    await override(c, s.businessId, 'receipt_uploads_month', 1);
    const req = { businessId: s.businessId, plan: 'basic', period: 'monthly', method: 'instapay', payerPhone: '01558858884', receipt: JPEG };
    expect((await c.call('POST', '/v1/billing/manual/requests', req, s.h)).status).toBe(201);
    expect((await usage(c, s.businessId, 'receipt_uploads')).count).toBe(1);
    const r = await c.call('POST', '/v1/billing/manual/requests', req, s.h);
    expect(r.status).toBe(429);
    expect(r.json.error).toMatchObject({ code: 'limit_reached', key: 'receipt_uploads_month', limit: 1, used: 1 });
  });

  it('api_requests_day is soft (429 after the limit) and never blocks /checkin', async () => {
    const c = makeClient();
    const s = await shop(c, '01077770013');
    await override(c, s.businessId, 'api_requests_day', 3); // sign-up already used 1
    expect((await c.call('GET', `/v1/backups?businessId=${s.businessId}`, undefined, s.h)).status).toBe(200);
    expect((await c.call('GET', `/v1/backups?businessId=${s.businessId}`, undefined, s.h)).status).toBe(200);
    const r = await c.call('GET', `/v1/backups?businessId=${s.businessId}`, undefined, s.h);
    expect(r.status).toBe(429);
    expect(r.json.error).toMatchObject({ code: 'limit_reached', key: 'api_requests_day', limit: 3 });
    const ck = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(ck.status).toBe(200);
    // Next Cairo day: allowed again.
    c.advance(86_400_000);
    const ck2 = await c.call('POST', '/v1/checkin', { refreshToken: ck.json.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect((await c.call('GET', `/v1/backups?businessId=${s.businessId}`, undefined, { Authorization: `Bearer ${ck2.json.accessToken}` })).status).toBe(200);
  });
});

describe('admin usage & overrides', () => {
  const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 11));
  async function admin(c: Client) {
    const salt = '00112233445566778899aabbccddeeff';
    await c.env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(uuidv7(), `u${c.clock.now}@x.io`, await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
      .run();
    const r = await c.call('POST', '/admin/login', { email: `u${c.clock.now}@x.io`, password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
    expect(r.status).toBe(200);
    return { Authorization: `Bearer ${r.json.token}` };
  }

  it('needs an admin session', async () => {
    const c = makeClient();
    expect((await c.call('GET', '/admin/usage')).status).toBe(401);
    expect((await c.call('GET', '/admin/usage/businesses')).status).toBe(401);
    expect((await c.call('GET', '/admin/businesses/x/usage')).status).toBe(401);
    expect((await c.call('PUT', '/admin/businesses/x/limits', { limits: { sms_day: 1 } })).status).toBe(401);
  });

  it('global usage vs the free tier, per-shop table, overrides reach the licence', async () => {
    const c = makeClient(1_950_000_000_000);
    const s = await shop(c, '01077770020');
    const h = await admin(c);
    const g = await c.call('GET', '/admin/usage?days=7', undefined, h);
    expect(g.status).toBe(200);
    expect(g.json.free.requestsDay).toBe(100_000);
    expect(g.json.status.gauges.map((x: any) => x.key)).toEqual(['requests', 'd1_writes', 'd1_reads', 'r2_storage']);
    expect(g.json.totals.today.api_requests.count).toBeGreaterThan(0);
    expect(g.json.status.gauges[0].level).toBe('ok');

    const t = await c.call('GET', '/admin/usage/businesses?sort=requests', undefined, h);
    const row = t.json.businesses.find((b: any) => b.id === s.businessId);
    expect(row).toMatchObject({ plan: 'pro', devices: 1, limits: { sms_day: 20, backup_storage_mb: 100, api_requests_day: 15000 } });

    expect((await c.call('PUT', `/admin/businesses/${s.businessId}/limits`, { limits: { sms_day: 3, backup_storage_mb: 50, bogus: 1 } }, h)).status).toBe(400);
    expect((await c.call('PUT', `/admin/businesses/${s.businessId}/limits`, { limits: { sms_day: 3, backup_storage_mb: 50 }, note: 'VIP' }, h)).status).toBe(200);
    const d = await c.call('GET', `/admin/businesses/${s.businessId}/usage`, undefined, h);
    expect(d.status).toBe(200);
    const sms = d.json.limits.find((l: any) => l.key === 'sms_day');
    expect(sms).toMatchObject({ plan: 20, override: 3, effective: 3, note: 'VIP' });
    expect(d.json.limits.find((l: any) => l.key === 'devices')).toMatchObject({ plan: 5, override: null, effective: 5, used: 1 });

    // The licence carries the effective (overridden) limits.
    const ck = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const v = verifyLicence(ck.json.licence, { '2026-01': ed25519PublicKey(TEST_PK_SK) });
    expect(v.ok && v.payload.limits.sms_day).toBe(3);
    expect(v.ok && v.payload.limits.backup_storage_mb).toBe(50);

    // null = back to the plan value.
    expect((await c.call('PUT', `/admin/businesses/${s.businessId}/limits`, { limits: { sms_day: null } }, h)).status).toBe(200);
    const d2 = await c.call('GET', `/admin/businesses/${s.businessId}/usage`, undefined, h);
    expect(d2.json.limits.find((l: any) => l.key === 'sms_day')).toMatchObject({ override: null, effective: 20 });
    const audit = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'limits_override' AND target = ?1`).bind(s.businessId).first<{ n: number }>();
    expect(audit?.n).toBe(2);

    // Dashboard banner above 70 % of the free tier.
    await c.env.DB.prepare(`UPDATE usage_daily SET count = 80000 WHERE business_id = '*' AND day = ?1 AND metric = 'api_requests'`).bind(cairoDay(c.clock.now)).run();
    const m = await c.call('GET', '/admin/metrics', undefined, h);
    expect(m.json.usageAlert.gauges[0]).toMatchObject({ key: 'requests', level: 'warn' });
  });
});
