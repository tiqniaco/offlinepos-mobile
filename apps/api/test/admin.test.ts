import { describe, expect, it } from 'vitest';
import { base32Encode, totpCode, DAY_MS, verifyLicence, ed25519PublicKey, uuidv7 } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { makeClient, login, device, BACKUP_KEY, TEST_PK_SK } from './helpers';

const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 1));

async function createAdmin(c: ReturnType<typeof makeClient>, email: string) {
  const salt = '00112233445566778899aabbccddeeff';
  await c.env.DB.prepare(
    `INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(uuidv7(), email, await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
    .run();
}

async function adminLogin(c: ReturnType<typeof makeClient>, email: string) {
  const r = await c.call('POST', '/admin/login', { email, password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.json.token}` };
}

describe('admin auth (password + TOTP)', () => {
  it('requires a valid TOTP', async () => {
    const c = makeClient();
    await createAdmin(c, 'a1@x.io');
    const wrong = totpCode(SECRET, c.clock.now) === '123456' ? '654321' : '123456';
    expect((await c.call('POST', '/admin/login', { email: 'a1@x.io', password: 'correct horse', totp: wrong })).status).toBe(401);
    expect((await c.call('POST', '/admin/login', { email: 'a1@x.io', password: 'nope', totp: totpCode(SECRET, c.clock.now) })).status).toBe(401);
    expect((await c.call('POST', '/admin/login', { email: 'a1@x.io', password: 'correct horse', totp: totpCode(SECRET, c.clock.now) })).status).toBe(200);
  });

  it('blocks TOTP replay', async () => {
    const c = makeClient();
    await createAdmin(c, 'a2@x.io');
    const code = totpCode(SECRET, c.clock.now);
    expect((await c.call('POST', '/admin/login', { email: 'a2@x.io', password: 'correct horse', totp: code })).status).toBe(200);
    expect((await c.call('POST', '/admin/login', { email: 'a2@x.io', password: 'correct horse', totp: code })).status).toBe(401);
  });

  it('locks after 5 failures', async () => {
    const c = makeClient();
    await createAdmin(c, 'a3@x.io');
    for (let i = 0; i < 5; i++) await c.call('POST', '/admin/login', { email: 'a3@x.io', password: 'bad', totp: '000000' });
    c.advance(30_000);
    const r = await c.call('POST', '/admin/login', { email: 'a3@x.io', password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
    expect(r.status).toBe(429);
  });

  it('protects admin endpoints', async () => {
    const c = makeClient();
    expect((await c.call('GET', '/admin/businesses')).status).toBe(401);
  });
});

describe('admin actions', () => {
  it('extends a trial; the phone sees it at the next check-in; action is audit-logged', async () => {
    const c = makeClient();
    await createAdmin(c, 'a4@x.io');
    const h = await adminLogin(c, 'a4@x.io');
    const auth = await login(c, '01055555551');
    const created = await c.call(
      'POST',
      '/v1/businesses',
      { name: 'Test', country: 'SA', type: 'trading', vatRegistered: true, backupKey: BACKUP_KEY, device: device() },
      { Authorization: `Bearer ${auth.accessToken}` },
    );
    const list = await c.call('GET', '/admin/businesses?q=Test', undefined, h);
    expect(list.json.businesses.length).toBeGreaterThan(0);
    const id = created.json.business.id;
    expect((await c.call('POST', `/admin/businesses/${id}/extend-trial`, { days: 10 }, h)).status).toBe(200);
    const r = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: created.json.registration.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const v = verifyLicence(r.json.licence, { '2026-01': ed25519PublicKey(TEST_PK_SK) });
    expect(v.ok && v.payload.expires_at - c.clock.now).toBe(24 * DAY_MS);
    const audit = await c.call('GET', '/admin/audit', undefined, h);
    expect(audit.json.entries.some((e: any) => e.action === 'extend_trial' && e.target === id)).toBe(true);
  });

  it('edits plans', async () => {
    const c = makeClient();
    await createAdmin(c, 'a5@x.io');
    const h = await adminLogin(c, 'a5@x.io');
    const plans = await c.call('GET', '/admin/plans', undefined, h);
    expect(plans.json.plans.map((p: any) => p.code).sort()).toEqual(['basic', 'free', 'pro']);
    const r = await c.call(
      'PUT',
      '/admin/plans/basic',
      { nameAr: 'أساسي', nameEn: 'Basic', monthlyEgp: 19900, monthlySar: 4900, yearlyEgp: 199000, yearlySar: 49000, limits: { users: 3, products: 5000, parties: -1, invoices_month: 3000, backups_kept: 7 }, features: ['no_ads'], trialDays: 0, active: true },
      h,
    );
    expect(r.status).toBe(200);
  });
});
