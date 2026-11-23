/** Pre-launch hardening: approvals, plan changes, duplicate payments, RevenueCat, backups, cron, announcements, admin. */
import { describe, expect, it } from 'vitest';
import { base32Encode, totpCode, uuidv7, DAY_MS, verifyLicence, ed25519PublicKey } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { runCleanup } from '../src/cron/cleanup';
import { computeActivation } from '../src/billing/activate';
import { makeClient, login, device, BACKUP_KEY, TEST_PK_SK } from './helpers';

const keys = { '2026-01': ed25519PublicKey(TEST_PK_SK) };
const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 41));
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const JPEG2 = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x02, 0xff, 0xd9]);
const SHA = 'c'.repeat(64);
const RC = { Authorization: 'Bearer test-rc-secret' };
type Client = ReturnType<typeof makeClient>;

async function admin(c: Client, email: string) {
  const salt = '00112233445566778899aabbccddeeff';
  await c.env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(uuidv7(), email, await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
    .run();
  const r = await c.call('POST', '/admin/login', { email, password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.json.token}` };
}

async function shop(c: Client, phone: string) {
  const auth = await login(c, phone, `inst-${phone}`);
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  const r = await c.call('POST', '/v1/businesses', { name: 'محل', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(`inst-${phone}`) }, h);
  expect(r.status).toBe(201);
  return { h, auth, businessId: r.json.business.id as string, deviceId: r.json.registration.deviceId as string };
}

const biz = (c: Client, id: string) => c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(id).first<any>();
const setBiz = (c: Client, id: string, plan: string, status: string, expires: number, source = 'manual') =>
  c.env.DB.prepare(`UPDATE businesses SET plan_code = ?2, status = ?3, plan_expires_at = ?4, plan_source = ?5 WHERE id = ?1`).bind(id, plan, status, expires, source).run();
const payReq = (businessId: string, extra: Record<string, unknown> = {}) => ({ businessId, plan: 'pro', period: 'monthly', method: 'instapay', payerPhone: '01558858884', receipt: JPEG, ...extra });

describe('plan activation', () => {
  it('pro-rata: unused paid days of the current plan become extra days on the new plan; same plan extends', () => {
    const now = 1_000 * DAY_MS;
    const basic = { code: 'basic', monthly_egp: 14_900, monthly_sar: 3_900, is_free: 0 };
    const pro = { code: 'pro', monthly_egp: 29_900, monthly_sar: 7_900, is_free: 0 };
    const running = { id: 'b', plan_code: 'basic', plan_expires_at: now + 20 * DAY_MS, status: 'active', country: 'EG' };
    const up = computeActivation(running, basic, pro, 'pro', 31, now);
    expect(up.until).toBe(now + 31 * DAY_MS + Math.floor((20 * DAY_MS * 14_900) / 29_900));
    expect(up.creditDays).toBeCloseTo(9.97, 1);
    expect(computeActivation(running, basic, basic, 'basic', 31, now).until).toBe(now + 51 * DAY_MS);
    // A trial is not credited; an expired plan is not credited.
    expect(computeActivation({ ...running, status: 'trial' }, basic, pro, 'pro', 31, now).until).toBe(now + 31 * DAY_MS);
    expect(computeActivation({ ...running, plan_expires_at: now - 1 }, basic, pro, 'pro', 31, now).until).toBe(now + 31 * DAY_MS);
  });
});

describe('manual payments: approve, duplicates, idempotency', () => {
  it('approve is atomic, refuses suspended shops unless confirmed (and keeps the suspension), credits the old plan', async () => {
    const c = makeClient();
    const a = await admin(c, 'approve@kashiro.app');
    const s = await shop(c, '01099990001');
    await setBiz(c, s.businessId, 'basic', 'active', c.clock.now + 10 * DAY_MS);
    const r1 = await c.call('POST', '/v1/billing/manual/requests', payReq(s.businessId), s.h);
    expect(r1.status).toBe(201);
    const list = await c.call('GET', '/admin/payment-requests', undefined, a);
    expect(list.json.requests[0]).toMatchObject({ business_plan_code: 'basic', business_status: 'active', duplicate_receipts: 0 });

    const ok = await c.call('POST', `/admin/payment-requests/${r1.json.id}/approve`, {}, a);
    expect(ok.status).toBe(200);
    expect(ok.json.creditDays).toBeGreaterThan(4);
    const b = await biz(c, s.businessId);
    expect(b).toMatchObject({ plan_code: 'pro', status: 'active', plan_source: 'manual' });
    expect(b.plan_expires_at).toBe(ok.json.planExpiresAt);
    // Double click: nothing changes.
    const again = await c.call('POST', `/admin/payment-requests/${r1.json.id}/approve`, {}, a);
    expect(again.json.error.code).toBe('not_pending');
    expect((await biz(c, s.businessId)).plan_expires_at).toBe(b.plan_expires_at);

    // Suspended: refused, then confirmed → plan extended, still suspended; unsuspend restores "active".
    expect((await c.call('POST', `/admin/businesses/${s.businessId}/suspend`, { suspended: true }, a)).json.status).toBe('suspended');
    c.advance(61_000);
    const r2 = await c.call('POST', '/v1/billing/manual/requests', payReq(s.businessId, { receipt: JPEG2 }), s.h);
    expect(r2.status).toBe(201);
    const refused = await c.call('POST', `/admin/payment-requests/${r2.json.id}/approve`, {}, a);
    expect([refused.status, refused.json.error.code]).toEqual([409, 'business_suspended']);
    expect((await c.env.DB.prepare(`SELECT status FROM payment_requests WHERE id = ?1`).bind(r2.json.id).first<any>()).status).toBe('pending');
    const forced = await c.call('POST', `/admin/payment-requests/${r2.json.id}/approve`, { allowSuspended: true }, a);
    expect(forced.status).toBe(200);
    expect((await biz(c, s.businessId)).status).toBe('suspended');
    expect((await c.call('POST', `/admin/businesses/${s.businessId}/suspend`, { suspended: false }, a)).json.status).toBe('active');
  });

  it('same idempotency key returns the existing request; same receipt is flagged; reference is stored', async () => {
    const c = makeClient();
    const a = await admin(c, 'dupes@kashiro.app');
    const s = await shop(c, '01099990002');
    const key = uuidv7(c.clock.now);
    const r1 = await c.call('POST', '/v1/billing/manual/requests', payReq(s.businessId, { idempotencyKey: key, reference: ' 123456789 ' }), s.h);
    const r2 = await c.call('POST', '/v1/billing/manual/requests', payReq(s.businessId, { idempotencyKey: key, reference: '123456789' }), s.h);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.json.id).toBe(r1.json.id);
    const r3 = await c.call('POST', '/v1/billing/manual/requests', payReq(s.businessId, { idempotencyKey: uuidv7(c.clock.now + 1) }), s.h);
    expect(r3.status).toBe(201);
    const list = ((await c.call('GET', '/admin/payment-requests', undefined, a)).json.requests as any[]).filter((x) => x.business_id === s.businessId);
    expect(list).toHaveLength(2);
    expect(list.every((x) => x.duplicate_receipts >= 1)).toBe(true);
    expect(list.find((x) => x.id === r1.json.id)).toMatchObject({ reference: '123456789' });
  });
});

describe('RevenueCat webhook', () => {
  const ev = (c: Client, businessId: string, id: string, type: string, extra: object = {}) => ({
    api_version: '1.0',
    event: { id, type, app_user_id: businessId, product_id: 'daftarak_basic_monthly', expiration_at_ms: c.clock.now + 30 * DAY_MS, environment: 'PRODUCTION', ...extra },
  });

  it('never shortens a manual plan; product change uses new_product_id; refund → free; expiration; sandbox ignored', async () => {
    const c = makeClient();
    const s = await shop(c, '01099990003');
    const far = c.clock.now + 200 * DAY_MS;
    await setBiz(c, s.businessId, 'pro', 'active', far, 'manual');
    // A LOWER store plan does not replace a better manual plan that still runs.
    expect((await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x1', 'INITIAL_PURCHASE'), RC)).status).toBe(200);
    let b = await biz(c, s.businessId);
    expect(b).toMatchObject({ plan_code: 'pro', plan_source: 'manual', plan_expires_at: far });

    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x2', 'PRODUCT_CHANGE', { product_id: 'daftarak_basic_monthly', new_product_id: 'daftarak_pro_yearly', expiration_at_ms: c.clock.now + 365 * DAY_MS }), RC);
    b = await biz(c, s.businessId);
    expect(b).toMatchObject({ plan_code: 'pro', plan_source: 'store', billing_period: 'yearly', plan_expires_at: c.clock.now + 365 * DAY_MS, manual_plan_code: 'pro', manual_until: far });

    // Sandbox: recorded, ignored.
    const sb = await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x3', 'CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT', environment: 'SANDBOX' }), RC);
    expect(sb.json.ignored).toBe('sandbox');
    expect((await biz(c, s.businessId)).plan_code).toBe('pro');
    expect((await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x3', 'CANCELLATION'), RC)).json.duplicate).toBe(true);

    // Normal cancellation keeps access; EXPIRATION ends the store plan → back to the manual time still paid for.
    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x4', 'CANCELLATION', { cancel_reason: 'UNSUBSCRIBE' }), RC);
    expect((await biz(c, s.businessId)).plan_expires_at).toBe(c.clock.now + 365 * DAY_MS);
    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x5', 'EXPIRATION', { expiration_at_ms: c.clock.now + 5 * DAY_MS }), RC);
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'pro', plan_source: 'manual', plan_expires_at: far });
    // A store refund no longer touches the manual plan.
    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, s.businessId, 'x6', 'CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT' }), RC);
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'pro', plan_expires_at: far });
    const seen = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM billing_events WHERE business_id = ?1`).bind(s.businessId).first<any>();
    expect(seen.n).toBe(6);

    // Store only (no manual time): EXPIRATION ends it at the store expiry; a refund → free plan now.
    const t = await shop(c, '01099990013');
    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, t.businessId, 'y1', 'INITIAL_PURCHASE'), RC);
    expect(await biz(c, t.businessId)).toMatchObject({ plan_code: 'basic', plan_source: 'store', plan_expires_at: c.clock.now + 30 * DAY_MS });
    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, t.businessId, 'y2', 'EXPIRATION', { expiration_at_ms: c.clock.now + 5 * DAY_MS }), RC);
    expect((await biz(c, t.businessId)).plan_expires_at).toBe(c.clock.now + 5 * DAY_MS);
    await c.call('POST', '/v1/webhooks/revenuecat', ev(c, t.businessId, 'y3', 'CANCELLATION', { cancel_reason: 'CUSTOMER_SUPPORT' }), RC);
    expect(await biz(c, t.businessId)).toMatchObject({ plan_code: 'free', status: 'active' });
  });
});

describe('backups (server)', () => {
  const meta = (size: number, counts: Record<string, number> = { invoices: 100 }) => ({ size, sha256: SHA, counts, schemaVersion: 11 });
  const upload = async (c: Client, s: Awaited<ReturnType<typeof shop>>, m: ReturnType<typeof meta>) => {
    const u = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: m }, s.h);
    if (u.status !== 200) return u;
    await c.env.BACKUPS.put(new URL(u.json.url).pathname.split('/').slice(2).join('/'), 'x'.repeat(m.size));
    const cm = await c.call('POST', `/v1/backups/${u.json.backupId}/commit`, { businessId: s.businessId }, s.h);
    expect(cm.status).toBe(200);
    return u;
  };

  it('daily cap on manual uploads, size cap per plan', async () => {
    const c = makeClient();
    const s = await shop(c, '01099990004');
    for (let i = 0; i < 6; i++) expect((await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(10) }, s.h)).status).toBe(200);
    const seventh = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(10) }, s.h);
    expect([seventh.status, seventh.json.error.code]).toEqual([429, 'rate_limited']);
    await c.env.DB.prepare(`DELETE FROM rate_counters`).run();
    await setBiz(c, s.businessId, 'free', 'active', c.clock.now);
    const big = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(60 * 1024 * 1024) }, s.h);
    expect([big.status, big.json.error.code]).toEqual([413, 'backup_too_large']);
    // Over the cap on check-in: the licence check-in still succeeds, without a PUT URL.
    const ci = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, backupMeta: meta(60 * 1024 * 1024) });
    expect(ci.status).toBe(200);
    expect(ci.json).toMatchObject({ backupPut: null, backupError: 'backup_too_large' });
  });

  it('retention deletes R2 objects, never prunes after a near-empty backup, and stale uploads go with their objects', async () => {
    const c = makeClient();
    const s = await shop(c, '01099990005');
    await setBiz(c, s.businessId, 'free', 'active', c.clock.now); // keeps 3
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      c.advance(60_000);
      ids.push((await upload(c, s, meta(5))).json.backupId);
    }
    const objs = async () => (await c.env.BACKUPS.list({ prefix: `b/${s.businessId}/` })).objects.length;
    expect(await objs()).toBe(3);
    // A near-empty backup (fresh phone) commits but prunes nothing.
    c.advance(60_000);
    await upload(c, s, meta(5, { invoices: 3 }));
    expect(await objs()).toBe(4);
    // An abandoned upload: row + object are removed after 2 days (commit housekeeping and the cron).
    c.advance(60_000);
    const u = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(5) }, s.h);
    const key = new URL(u.json.url).pathname.split('/').slice(2).join('/');
    await c.env.BACKUPS.put(key, 'xxxxx');
    c.advance(3 * DAY_MS);
    const out = await runCleanup(c.env, c.clock.now);
    expect(out.uncommitted_backups).toBeGreaterThanOrEqual(1);
    expect(await c.env.BACKUPS.head(key)).toBeNull();
    expect(await c.env.DB.prepare(`SELECT id FROM backups WHERE id = ?1`).bind(u.json.backupId).first()).toBeNull();
  });
});

describe('cron cleanup', () => {
  it('drops old operational rows only', async () => {
    const c = makeClient();
    const now = c.clock.now;
    const old = now - 500 * DAY_MS;
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO client_errors (id, where_, message, at) VALUES ('ce-old', 'x', 'm', ?1), ('ce-new', 'x', 'm', ?2)`).bind(old, now),
      c.env.DB.prepare(`INSERT INTO otp_send_log (id, phone_masked, provider, ok, at) VALUES ('ol-old', '20••', 'console', 1, ?1)`).bind(old),
      c.env.DB.prepare(`INSERT INTO rate_counters (key, window_start, count) VALUES ('cron-test', ?1, 1)`).bind(old),
      c.env.DB.prepare(`INSERT INTO otp_codes (id, phone, purpose, code_hash, created_at, expires_at) VALUES ('oc-old', '201', 'login', 'h', ?1, ?1)`).bind(old),
    ]);
    const out = await runCleanup(c.env, now);
    expect(out.client_errors).toBeGreaterThanOrEqual(1);
    expect(await c.env.DB.prepare(`SELECT id FROM client_errors WHERE id = 'ce-new'`).first()).not.toBeNull();
    expect(await c.env.DB.prepare(`SELECT id FROM client_errors WHERE id = 'ce-old'`).first()).toBeNull();
    expect(await c.env.DB.prepare(`SELECT id FROM otp_send_log WHERE id = 'ol-old'`).first()).toBeNull();
    expect(await c.env.DB.prepare(`SELECT key FROM rate_counters WHERE key = 'cron-test'`).first()).toBeNull();
    expect(await c.env.DB.prepare(`SELECT id FROM otp_codes WHERE id = 'oc-old'`).first()).toBeNull();
  });
});

describe('announcements backlog', () => {
  it("other shops' backlog never pushes this shop's message out of the check-in", async () => {
    const c = makeClient();
    const s = await shop(c, '01099990006');
    c.advance(1000);
    for (let i = 0; i < 25; i++) {
      await c.env.DB.prepare(`INSERT INTO announcements (id, title_ar, body_ar, target_json, created_at, expires_at) VALUES (?1, 't', 'b', ?2, ?3, ?4)`)
        .bind('o' + i, JSON.stringify({ businessIds: ['other'] }), c.clock.now + i, c.clock.now + 9e9)
        .run();
    }
    await c.env.DB.prepare(`INSERT INTO announcements (id, title_ar, body_ar, target_json, created_at, expires_at) VALUES ('mine', 't', 'b', ?1, ?2, ?3)`)
      .bind(JSON.stringify({ businessIds: [s.businessId] }), c.clock.now + 100, c.clock.now + 9e9)
      .run();
    await c.env.DB.prepare(`INSERT INTO announcements (id, title_ar, body_ar, target_json, created_at, expires_at) VALUES ('all', 't', 'b', '{"all":true}', ?1, ?2)`)
      .bind(c.clock.now + 101, c.clock.now + 9e9)
      .run();
    c.advance(1000);
    const r = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r.json.announcements.map((a: any) => a.id)).toEqual(['mine', 'all']);
    const r2 = await c.call('POST', '/v1/checkin', { refreshToken: r.json.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r2.json.announcements).toEqual([]);
  });
});

describe('admin', () => {
  it('extend-trial never downgrades a paying shop; expired shows as expired; client errors listed', async () => {
    const c = makeClient();
    const a = await admin(c, 'ops@kashiro.app');
    const s = await shop(c, '01099990007');
    const until = c.clock.now + 40 * DAY_MS;
    await setBiz(c, s.businessId, 'basic', 'active', until);
    const ext = await c.call('POST', `/admin/businesses/${s.businessId}/extend-trial`, { days: 7 }, a);
    expect(ext.json).toMatchObject({ keptPlan: true, planExpiresAt: until + 7 * DAY_MS });
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'basic', status: 'active' });

    await setBiz(c, s.businessId, 'basic', 'active', c.clock.now - DAY_MS);
    const list = await c.call('GET', '/admin/businesses', undefined, a);
    expect(list.json.businesses.find((x: any) => x.id === s.businessId)).toMatchObject({ status: 'expired', stored_status: 'active' });
    expect((await c.call('GET', '/admin/metrics', undefined, a)).json.expired).toBeGreaterThanOrEqual(1);
    const prev = await c.call('POST', '/admin/announcements/preview', { statuses: ['expired'] }, a);
    expect(prev.json.businesses).toBeGreaterThanOrEqual(1);

    await c.call('POST', '/v1/client-errors', { where: 'boot', message: 'boom' });
    const errs = await c.call('GET', '/admin/client-errors', undefined, a);
    expect(errs.json.errors[0]).toMatchObject({ place: 'boot', message: 'boom' });
  });

  it('custom_roles is gone from every plan (migration)', async () => {
    const c = makeClient();
    const s = await shop(c, '01099990008');
    const r = await c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const v = verifyLicence(r.json.licence, keys);
    expect(v.ok && v.payload.features).not.toContain('custom_roles');
  });
});
