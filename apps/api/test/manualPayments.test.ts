import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { base32Encode, totpCode, uuidv7, DAY_MS } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { createApp } from '../src/index';
import { ConsoleProvider } from '../src/otp/providers';
import type { Env } from '../src/env';
import { makeClient, login, device, BACKUP_KEY } from './helpers';

const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 31));
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function admin(c: ReturnType<typeof makeClient>, email: string) {
  const salt = '00112233445566778899aabbccddeeff';
  await c.env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(uuidv7(), email, await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
    .run();
  const r = await c.call('POST', '/admin/login', { email, password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.json.token}` };
}

async function shop(c: ReturnType<typeof makeClient>, phone: string) {
  const auth = await login(c, phone, `inst-${phone}`);
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  const r = await c.call('POST', '/v1/businesses', { name: 'محل الأمل', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(`inst-${phone}`) }, h);
  expect(r.status).toBe(201);
  return { h, businessId: r.json.business.id as string, refresh: auth.refreshToken as string, deviceId: r.json.registration.deviceId as string };
}

const req = (businessId: string, extra: Record<string, unknown> = {}) => ({ businessId, plan: 'basic', period: 'monthly', method: 'instapay', payerPhone: '+20 155 885 8884', receipt: JPEG, ...extra });

describe('manual payments (app side)', () => {
  it('info lists numbers, SLA and paid plans; create stores receipt in R2 and lists the request', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777701');
    const info = await c.call('GET', `/v1/billing/manual/info?businessId=${s.businessId}`, undefined, s.h);
    expect(info.status).toBe(200);
    expect(info.json.methods).toEqual([
      { id: 'instapay', number: '01558858884' },
      { id: 'vodafone_cash', number: '01017686542' },
    ]);
    expect(info.json.slaHours).toBe(12);
    expect(info.json.plans.map((p: any) => p.code)).toEqual(['basic', 'pro']);
    expect(info.json.plans[0]).toMatchObject({ nameAr: 'أساسي', monthlyMinor: 14900, yearlyMinor: 149000 });

    const r = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId, { period: 'yearly', note: 'حولت من رقم أخويا' }), s.h);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ status: 'pending', amountMinor: 149000, createdAt: c.clock.now });
    const row = await c.env.DB.prepare(`SELECT * FROM payment_requests WHERE id = ?1`).bind(r.json.id).first<any>();
    expect(row).toMatchObject({ payer_phone: '01558858884', currency: 'EGP', receipt_key: `receipts/${s.businessId}/${r.json.id}.jpg`, note: 'حولت من رقم أخويا' });
    const obj = await c.env.BACKUPS.get(row.receipt_key);
    expect(obj?.httpMetadata?.contentType).toBe('image/jpeg');

    const png = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId, { receipt: `data:image/png;base64,${PNG}`, method: 'vodafone_cash' }), s.h);
    expect(png.status).toBe(201);

    const list = await c.call('GET', `/v1/billing/manual/requests?businessId=${s.businessId}`, undefined, s.h);
    expect(list.json.requests).toHaveLength(2);
    expect(list.json.requests[1]).toMatchObject({ id: r.json.id, plan: 'basic', period: 'yearly', amountMinor: 149000, method: 'instapay', status: 'pending', rejectReason: null, reviewedAt: null });
  });

  it('rejects invalid receipts, bad phones and unknown / free plans', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777702');
    const bad = async (extra: Record<string, unknown>) => (await c.call('POST', '/v1/billing/manual/requests', req(s.businessId, extra), s.h)).json.error.code;
    expect(await bad({ receipt: b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]) })).toBe('receipt_invalid'); // GIF
    expect(await bad({ receipt: '!!!not-base64!!!' })).toBe('receipt_invalid');
    const big = new Uint8Array(2 * 1024 * 1024 + 10);
    big.set([0xff, 0xd8, 0xff]);
    let bin = '';
    for (let i = 0; i < big.length; i += 8192) bin += String.fromCharCode(...big.subarray(i, i + 8192));
    const tooBig = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId, { receipt: btoa(bin) }), s.h);
    expect([tooBig.status === 400 || tooBig.status === 413, tooBig.json.error.code]).toEqual([true, 'receipt_invalid']);
    expect(await bad({ payerPhone: '0555555555' })).toBe('invalid_phone');
    expect(await bad({ plan: 'free' })).toBe('invalid_request');
    expect(await bad({ plan: 'gold' })).toBe('invalid_request');
    expect((await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM payment_requests WHERE business_id = ?1`).bind(s.businessId).first<{ n: number }>())!.n).toBe(0);
  });

  it('only the owner can use the endpoints', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777703');
    const other = await login(c, '01077777704', 'inst-other');
    const oh = { Authorization: `Bearer ${other.accessToken}` };
    expect((await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), oh)).status).toBe(404);
    expect((await c.call('GET', `/v1/billing/manual/requests?businessId=${s.businessId}`, undefined, oh)).status).toBe(404);
    expect((await c.call('GET', `/v1/billing/manual/info?businessId=${s.businessId}`, undefined, oh)).status).toBe(404);
    expect((await c.call('GET', `/v1/billing/manual/info?businessId=${s.businessId}`)).status).toBe(401);
  });

  it('caps pending requests at 3 and requests per day at 10', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777705');
    for (let i = 0; i < 3; i++) expect((await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h)).status).toBe(201);
    const fourth = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h);
    expect([fourth.status, fourth.json.error.code]).toEqual([409, 'too_many_pending']);
    // Rejected ones free a slot, but the daily cap still applies.
    await c.env.DB.prepare(`UPDATE payment_requests SET status = 'rejected' WHERE business_id = ?1`).bind(s.businessId).run();
    for (let i = 0; i < 3; i++) expect((await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h)).status).toBe(201);
    await c.env.DB.prepare(`UPDATE payment_requests SET status = 'rejected' WHERE business_id = ?1`).bind(s.businessId).run();
    for (let i = 0; i < 3; i++) expect((await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h)).status).toBe(201);
    await c.env.DB.prepare(`UPDATE payment_requests SET status = 'rejected' WHERE business_id = ?1`).bind(s.businessId).run();
    expect((await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h)).status).toBe(201); // 10th
    const eleventh = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h);
    expect([eleventh.status, eleventh.json.error.code]).toEqual([429, 'rate_limited']);
    expect(eleventh.json.error.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('manual payments (super admin)', () => {
  it('approve activates the plan (extends same plan), sets expiry, notifies the business; double approve → 409', async () => {
    const pushed: unknown[] = [];
    const c = makeClient(1_800_000_000_000, { push: async (_e, m) => (pushed.push(...m), [m.length, 0]) });
    const s = await shop(c, '01077777706');
    const h = await admin(c, 'pay1@x.io');
    const r = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h);

    const list = await c.call('GET', '/admin/payment-requests?status=pending', undefined, h);
    const pendingBefore = list.json.pendingCount as number;
    expect(pendingBefore).toBeGreaterThanOrEqual(1);
    expect(list.json.requests.find((x: any) => x.id === r.json.id)).toMatchObject({ id: r.json.id, business_name: 'محل الأمل', owner_phone: '201077777706', plan_code: 'basic', amount_minor: 14900, method: 'instapay', payer_phone: '01558858884' });
    expect((await c.call('GET', '/admin/metrics', undefined, h)).json.pendingPayments).toBe(pendingBefore);

    const ok = await c.call('POST', `/admin/payment-requests/${r.json.id}/approve`, {}, h);
    expect(ok.status).toBe(200);
    expect(ok.json.planExpiresAt).toBe(c.clock.now + 31 * DAY_MS);
    expect((await c.call('GET', '/admin/payment-requests', undefined, h)).json.pendingCount).toBe(pendingBefore - 1);
    const b = await c.env.DB.prepare(`SELECT plan_code, status, plan_source, billing_period, plan_expires_at FROM businesses WHERE id = ?1`).bind(s.businessId).first<any>();
    expect(b).toEqual({ plan_code: 'basic', status: 'active', plan_source: 'manual', billing_period: 'monthly', plan_expires_at: c.clock.now + 31 * DAY_MS });

    const again = await c.call('POST', `/admin/payment-requests/${r.json.id}/approve`, {}, h);
    expect([again.status, again.json.error.code]).toEqual([409, 'not_pending']);
    expect((await c.call('POST', `/admin/payment-requests/${r.json.id}/reject`, { reason: 'متأخر' }, h)).status).toBe(409);

    // Renewal of the same plan extends from the current expiry; custom days.
    const r2 = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h);
    const prev = b.plan_expires_at as number;
    const ok2 = await c.call('POST', `/admin/payment-requests/${r2.json.id}/approve`, { days: 40 }, h);
    expect(ok2.json.planExpiresAt).toBe(prev + 40 * DAY_MS);

    const audit = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE action = 'payment_approve'`).first<{ n: number }>();
    expect(audit!.n).toBe(2);
    const listed = await c.call('GET', `/v1/billing/manual/requests?businessId=${s.businessId}`, undefined, s.h);
    expect(listed.json.requests.every((x: any) => x.status === 'approved' && x.reviewedAt)).toBe(true);

    // The business gets an in-app announcement with the next check-in.
    c.advance(DAY_MS);
    const ci = await c.call('POST', '/v1/checkin', { refreshToken: s.refresh, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(ci.status).toBe(200);
    const ann = ci.json.announcements.find((a: any) => a.titleAr === 'تم تفعيل باقتك 🎉');
    expect(ann.bodyAr).toContain('أساسي');
    expect(ann.url).toBe('/settings/subscription');
    // Another business does not get it.
    const other = await shop(c, '01077777707');
    c.advance(DAY_MS);
    const ci2 = await c.call('POST', '/v1/checkin', { refreshToken: other.refresh, deviceId: other.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(ci2.json.announcements.some((a: any) => a.titleAr === 'تم تفعيل باقتك 🎉')).toBe(false);

  });

  it('reject stores the reason, notifies and requires a reason', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777708');
    const h = await admin(c, 'pay2@x.io');
    const r = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId), s.h);
    expect((await c.call('POST', `/admin/payment-requests/${r.json.id}/reject`, {}, h)).status).toBe(400);
    expect((await c.call('POST', `/admin/payment-requests/${r.json.id}/reject`, { reason: 'x'.repeat(201) }, h)).status).toBe(400);
    expect((await c.call('POST', `/admin/payment-requests/${r.json.id}/reject`, { reason: 'المبلغ ناقص' }, h)).status).toBe(200);
    const listed = await c.call('GET', `/v1/billing/manual/requests?businessId=${s.businessId}`, undefined, s.h);
    expect(listed.json.requests[0]).toMatchObject({ status: 'rejected', rejectReason: 'المبلغ ناقص' });
    const ann = await c.env.DB.prepare(`SELECT title_ar, body_ar, target_json FROM announcements ORDER BY created_at DESC LIMIT 1`).first<any>();
    expect(ann.body_ar).toContain('المبلغ ناقص');
    expect(JSON.parse(ann.target_json)).toEqual({ businessIds: [s.businessId] });
    const biz = await c.env.DB.prepare(`SELECT plan_source FROM businesses WHERE id = ?1`).bind(s.businessId).first<any>();
    expect(biz.plan_source).not.toBe('manual');
    expect((await c.call('GET', '/admin/payment-requests?status=rejected', undefined, h)).json.requests.find((x: any) => x.id === r.json.id).reject_reason).toBe('المبلغ ناقص');
    expect((await c.call('GET', '/admin/payment-requests?status=all', undefined, h)).json.requests.length).toBeGreaterThan(0);
  });

  it('receipt endpoint needs admin auth and streams the image with its content type', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777709');
    const h = await admin(c, 'pay3@x.io');
    const r = await c.call('POST', '/v1/billing/manual/requests', req(s.businessId, { receipt: PNG }), s.h);
    expect((await c.call('GET', `/admin/payment-requests/${r.json.id}/receipt`)).status).toBe(401);
    expect((await c.call('GET', `/admin/payment-requests/${r.json.id}/receipt`, undefined, s.h)).status).toBe(401); // app session ≠ admin
    const app = createApp({ now: () => c.clock.now, provider: () => new ConsoleProvider() });
    const res = await app.request(`/admin/payment-requests/${r.json.id}/receipt`, { headers: h }, env as unknown as Env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('payment numbers + SLA are editable in settings and shown to the app', async () => {
    const c = makeClient();
    const s = await shop(c, '01077777710');
    const h = await admin(c, 'pay4@x.io');
    expect((await c.call('GET', '/admin/settings', undefined, h)).json).toMatchObject({ pay_instapay: '01558858884', pay_vodafone_cash: '01017686542', pay_sla_hours: '12' });
    expect((await c.call('PUT', '/admin/settings/payments', { instapay: 'shop@instapay', vodafoneCash: '0101', slaHours: 6 }, h)).status).toBe(400);
    expect((await c.call('PUT', '/admin/settings/payments', { instapay: 'shop@instapay', vodafoneCash: '01011112222', slaHours: 6 }, h)).status).toBe(200);
    const info = await c.call('GET', `/v1/billing/manual/info?businessId=${s.businessId}`, undefined, s.h);
    expect(info.json.methods).toEqual([
      { id: 'instapay', number: 'shop@instapay' },
      { id: 'vodafone_cash', number: '01011112222' },
    ]);
    expect(info.json.slaHours).toBe(6);
    // restore defaults for other tests sharing the DB
    await c.call('PUT', '/admin/settings/payments', { instapay: '01558858884', vodafoneCash: '01017686542', slaHours: 12 }, h);
  });
});
