import { describe, expect, it } from 'vitest';
import { base32Encode, totpCode, DAY_MS, verifyLicence, ed25519PublicKey, uuidv7, base64urlEncode } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { ConsoleProvider } from '../src/otp/providers';
import { planFromProduct } from '../src/routes/phase6';
import { makeClient, login, device, BACKUP_KEY, TEST_PK_SK } from './helpers';

const keys = { '2026-01': ed25519PublicKey(TEST_PK_SK) };
const SHA = 'b'.repeat(64);

async function onboard(c: ReturnType<typeof makeClient>, phone: string) {
  const auth = await login(c, phone);
  const r = await c.call('POST', '/v1/businesses', { name: 'بقالة', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, { Authorization: `Bearer ${auth.accessToken}` });
  expect(r.status).toBe(201);
  return { auth, reg: r.json.registration, business: r.json.business, h: { Authorization: `Bearer ${auth.accessToken}` } };
}

async function stepUp(c: ReturnType<typeof makeClient>, h: Record<string, string>, phone: string) {
  c.advance(61_000); // OTP resend cooldown after the login code
  const r = await c.call('POST', '/v1/auth/step-up/request', {}, h);
  expect(r.status).toBe(200);
  const code = ConsoleProvider.lastCodeFor(r.json.phone ?? phone) ?? ConsoleProvider.lastCodeFor(`20${phone.slice(1)}`)!;
  expect((await c.call('POST', '/v1/auth/step-up/verify', { code }, h)).status).toBe(200);
}

describe('cloud backups', () => {
  it('upload URL → R2 upload → commit → list → download URL; retention keeps the newest N', async () => {
    const c = makeClient();
    const { business, reg, h } = await onboard(c, '01044444441');
    const meta = { size: 11, sha256: SHA, counts: { invoices: 5 }, schemaVersion: 11 };
    const ids: string[] = [];
    // Pro trial keeps 30; switch the business to basic (7) to exercise retention.
    await c.env.DB.prepare(`UPDATE businesses SET plan_code = 'basic' WHERE id = ?1`).bind(business.id).run();
    for (let i = 0; i < 9; i++) {
      c.advance(60_000);
      await c.env.DB.prepare(`DELETE FROM rate_counters WHERE key LIKE 'backup-upload:%'`).run(); // the daily cap has its own test
      const u = await c.call('POST', '/v1/backups/upload-url', { businessId: business.id, deviceId: reg.deviceId, meta }, h);
      expect(u.status).toBe(200);
      expect(u.json.url).toContain('X-Amz-Signature');
      expect(u.json.url).toContain(`b/${business.id}/${reg.deviceId}/`);
      // not uploaded yet → commit refused
      if (i === 0) expect((await c.call('POST', `/v1/backups/${u.json.backupId}/commit`, { businessId: business.id }, h)).json.error.code).toBe('backup_not_uploaded');
      const key = new URL(u.json.url).pathname.split('/').slice(2).join('/');
      await c.env.BACKUPS.put(key, 'x'.repeat(11));
      expect((await c.call('POST', `/v1/backups/${u.json.backupId}/commit`, { businessId: business.id }, h)).status).toBe(200);
      ids.push(u.json.backupId);
    }
    const list = await c.call('GET', `/v1/backups?businessId=${business.id}`, undefined, h);
    expect(list.json.backups.map((b: any) => b.id)).toEqual(ids.slice(-7).reverse());
    expect(list.json.backups[0]).toMatchObject({ size: 11, counts: { invoices: 5 }, deviceCode: 'A' });
    const oldKey = `b/${business.id}/${reg.deviceId}/${ids[0]}.obk`;
    expect(await c.env.BACKUPS.head(oldKey)).toBeNull();
    const d = await c.call('POST', `/v1/backups/${ids.at(-1)}/download-url`, {}, h);
    expect(d.json).toMatchObject({ sha256: SHA, size: 11 });
    expect(d.json.url).toContain('X-Amz-Signature');
  });

  it('check-in carries the backup: PUT URL today, commit tomorrow (no extra requests)', async () => {
    const c = makeClient();
    const { auth, business, reg } = await onboard(c, '01044444442');
    c.advance(DAY_MS);
    const meta = { size: 5, sha256: SHA, counts: {}, schemaVersion: 11 };
    const r1 = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, backupMeta: meta });
    expect(r1.json.backupPut.url).toContain('X-Amz-Signature');
    await c.env.BACKUPS.put(new URL(r1.json.backupPut.url).pathname.split('/').slice(2).join('/'), '12345');
    c.advance(DAY_MS);
    const r2 = await c.call('POST', '/v1/checkin', { refreshToken: r1.json.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, committedBackupId: r1.json.backupPut.backupId });
    expect(r2.json.backupCommitted).toBe(true);
    const rows = await c.env.DB.prepare(`SELECT committed_at FROM backups WHERE business_id = ?1`).bind(business.id).all<any>();
    expect(rows.results[0].committed_at).toBeTruthy();
  });

  it('backup key only after a fresh step-up OTP; audited', async () => {
    const c = makeClient();
    const { business, h } = await onboard(c, '01044444443');
    expect((await c.call('POST', '/v1/backups/key', { businessId: business.id }, h)).json.error.code).toBe('step_up_required');
    await stepUp(c, h, '01044444443');
    const r = await c.call('POST', '/v1/backups/key', { businessId: business.id }, h);
    expect(r.json.backupKey).toBe(BACKUP_KEY);
    const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM key_releases WHERE business_id = ?1`).bind(business.id).first<any>();
    expect(n.n).toBe(1);
    c.advance(11 * 60_000); // step-up expired
    expect((await c.call('POST', '/v1/backups/key', { businessId: business.id }, h)).json.error.code).toBe('step_up_required');
  });

  it('restore on a new phone: activate (step-up) → new device code, old phone deactivated at its next check-in', async () => {
    const c = makeClient();
    const { auth, business, reg } = await onboard(c, '01044444444');
    c.advance(61_000);
    const auth2 = await login(c, '01044444444', 'install-0002');
    const h2 = { Authorization: `Bearer ${auth2.accessToken}` };
    expect((await c.call('POST', '/v1/devices/activate', { businessId: business.id, device: device('install-0002') }, h2)).json.error.code).toBe('step_up_required');
    await stepUp(c, h2, '01044444444');
    const r = await c.call('POST', '/v1/devices/activate', { businessId: business.id, device: device('install-0002') }, h2);
    expect(r.status).toBe(200);
    expect(r.json.registration.deviceCode).toBe('B');
    const old = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const v = verifyLicence(old.json.licence, keys);
    expect(v.ok && v.payload.status).toBe('deactivated');
  });
});

describe('request budget (≤ 5 per business per day)', () => {
  it('3-day simulated run with daily check-in + automatic backup = 1 Worker request/day (+1 R2 PUT direct)', async () => {
    const c = makeClient(1_900_000_000_000);
    const { auth, business, reg } = await onboard(c, '01044444447'); // day 0: sign-up
    let refresh = auth.refreshToken;
    let pending: string | undefined;
    const days: number[] = [];
    for (let d = 1; d <= 3; d++) {
      c.advance(DAY_MS);
      const r = await c.call('POST', '/v1/checkin', { refreshToken: refresh, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, anchor: { chainSeq: d, chainHead: SHA, auditSeq: d, auditHead: SHA }, backupMeta: { size: 3, sha256: SHA, counts: {}, schemaVersion: 11 }, committedBackupId: pending });
      expect(r.status).toBe(200);
      refresh = r.json.refreshToken;
      pending = r.json.backupPut.backupId;
      await c.env.BACKUPS.put(new URL(r.json.backupPut.url).pathname.split('/').slice(2).join('/'), 'abc'); // direct to R2
      const dt = new Date(c.clock.now);
      days.push(dt.getUTCFullYear() * 10000 + (dt.getUTCMonth() + 1) * 100 + dt.getUTCDate());
    }
    for (const day of days) {
      const row = await c.env.DB.prepare(`SELECT count FROM request_counters WHERE business_id = ?1 AND day = ?2`).bind(business.id, day).first<any>();
      expect(row.count).toBe(1);
    }
  });
});

describe('activation codes & billing', () => {
  const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 7));
  async function admin(c: ReturnType<typeof makeClient>) {
    const salt = '00112233445566778899aabbccddeeff';
    await c.env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(uuidv7(), 'ops@x.io', await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
      .run();
    const r = await c.call('POST', '/admin/login', { email: 'ops@x.io', password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
    return { Authorization: `Bearer ${r.json.token}` };
  }

  it('admin generates codes; owner redeems once; licence becomes the plan; metrics count it', async () => {
    const c = makeClient();
    const a = await admin(c);
    const g = await c.call('POST', '/admin/codes', { planCode: 'basic', days: 365, count: 3, note: 'agent' }, a);
    expect(g.status).toBe(201);
    expect(g.json.codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const { auth, business, reg, h } = await onboard(c, '01044444445');
    expect((await c.call('POST', '/v1/licence/activation-code', { businessId: business.id, code: 'AAAA-BBBB-CCCC' }, h)).json.error.code).toBe('code_invalid');
    const r = await c.call('POST', '/v1/licence/activation-code', { businessId: business.id, code: g.json.codes[0].toLowerCase().replace(/-/g, ' ') }, h);
    expect(r.status).toBe(200);
    expect(r.json.expiresAt - c.clock.now).toBe(365 * DAY_MS);
    expect((await c.call('POST', '/v1/licence/activation-code', { businessId: business.id, code: g.json.codes[0] }, h)).json.error.code).toBe('code_used');
    const ci = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const v = verifyLicence(ci.json.licence, keys);
    expect(v.ok && v.payload.plan).toBe('basic');
    expect(v.ok && v.payload.status).toBe('active');
    expect((await c.call('POST', `/admin/codes/${g.json.codes[1]}/revoke`, {}, a)).status).toBe(200);
    expect((await c.call('POST', '/v1/licence/activation-code', { businessId: business.id, code: g.json.codes[1] }, h)).json.error.code).toBe('code_invalid');
    const m = await c.call('GET', '/admin/metrics', undefined, a);
    expect(m.json.paid).toBeGreaterThanOrEqual(1);
    expect(m.json.byPlan.basic).toBeGreaterThanOrEqual(1);
    expect(m.json.mrrMinor.EGP).toBeGreaterThanOrEqual(14_900);
  });

  it('RevenueCat webhook: secret, idempotent, purchase → plan until store expiry, billing issue → past_due', async () => {
    const c = makeClient();
    const { business } = await onboard(c, '01044444446');
    const ev = (id: string, type: string, extra: object = {}) => ({ api_version: '1.0', event: { id, type, app_user_id: business.id, product_id: 'daftarak_pro_yearly', expiration_at_ms: c.clock.now + 365 * DAY_MS, ...extra } });
    expect((await c.call('POST', '/v1/webhooks/revenuecat', ev('e1', 'INITIAL_PURCHASE'), { Authorization: 'wrong' })).status).toBe(401);
    expect((await c.call('POST', '/v1/webhooks/revenuecat', ev('e1', 'INITIAL_PURCHASE'), { Authorization: 'Bearer test-rc-secret' })).status).toBe(200);
    let b = await c.env.DB.prepare(`SELECT plan_code, status, plan_source, billing_period, plan_expires_at FROM businesses WHERE id = ?1`).bind(business.id).first<any>();
    expect(b).toMatchObject({ plan_code: 'pro', status: 'active', plan_source: 'store', billing_period: 'yearly' });
    expect((await c.call('POST', '/v1/webhooks/revenuecat', ev('e1', 'INITIAL_PURCHASE'), { Authorization: 'Bearer test-rc-secret' })).json.duplicate).toBe(true);
    await c.call('POST', '/v1/webhooks/revenuecat', ev('e2', 'BILLING_ISSUE'), { Authorization: 'Bearer test-rc-secret' });
    b = await c.env.DB.prepare(`SELECT status FROM businesses WHERE id = ?1`).bind(business.id).first<any>();
    expect(b.status).toBe('past_due');
    expect(planFromProduct('daftarak.basic.monthly')).toEqual({ plan: 'basic', period: 'monthly' });
    expect(planFromProduct('something')).toBeNull();
    void base64urlEncode;
  });
});
