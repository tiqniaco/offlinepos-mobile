import { describe, expect, it } from 'vitest';
import { base32Encode, totpCode, uuidv7, DAY_MS } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { matches, targetSql } from '../src/announce/announce';
import type { PushMessage } from '../src/announce/announce';
import { makeClient, login, device, BACKUP_KEY } from './helpers';

const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 11));

async function admin(c: ReturnType<typeof makeClient>, email: string) {
  const salt = '00112233445566778899aabbccddeeff';
  await c.env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(uuidv7(), email, await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
    .run();
  const r = await c.call('POST', '/admin/login', { email, password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
  return { Authorization: `Bearer ${r.json.token}` };
}

async function shop(c: ReturnType<typeof makeClient>, phone: string, country: 'EG' | 'SA' = 'EG') {
  const auth = await login(c, phone, `inst-${phone}`);
  const r = await c.call('POST', '/v1/businesses', { name: 'محل', country, type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(`inst-${phone}`) }, { Authorization: `Bearer ${auth.accessToken}` });
  expect(r.status).toBe(201);
  return { refresh: auth.refreshToken as string, deviceId: r.json.registration.deviceId as string, businessId: r.json.business.id as string };
}

describe('announcement targeting', () => {
  it('matches and SQL agree; empty target reaches nobody', () => {
    const b = { id: 'x', country: 'SA', plan_code: 'pro', status: 'trial' };
    expect(matches({ all: true }, b)).toBe(true);
    expect(matches({}, b)).toBe(false);
    expect(targetSql({}).where).toBe('0 = 1');
    expect(matches({ countries: ['SA'], statuses: ['trial'] }, b)).toBe(true);
    expect(matches({ countries: ['EG'] }, b)).toBe(false);
    expect(matches({ businessIds: ['x'] }, b)).toBe(true);
  });
});

describe('super-admin announcements', () => {
  it('push to phones with a token + inbox copy on the next check-in (once); targeting; cancel; audit', async () => {
    const pushed: PushMessage[][] = [];
    const c = makeClient(1_800_000_000_000, { push: async (_e, m) => (pushed.push(m), [m.length, 0]) });
    const eg = await shop(c, '01055555551', 'EG');
    const sa = await shop(c, '0555555552', 'SA');
    // EG phone registers its push token with a check-in.
    c.advance(DAY_MS);
    const ci = await c.call('POST', '/v1/checkin', { refreshToken: eg.refresh, deviceId: eg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, pushToken: 'ExponentPushToken[eg]' });
    expect(ci.status).toBe(200);
    expect(ci.json.announcements).toEqual([]);
    eg.refresh = ci.json.refreshToken;

    const a = await admin(c, 'notify@x.io');
    // validation: bad screen link refused; non-admin refused
    expect((await c.call('POST', '/admin/announcements', { titleAr: 'تحديث', bodyAr: 'نسخة جديدة', url: 'https://evil.example', target: { all: true } }, a)).status).toBe(400);
    expect((await c.call('POST', '/admin/announcements', { titleAr: 'تحديث', bodyAr: 'نسخة جديدة', target: { all: true } })).status).toBe(401);

    const pv = await c.call('POST', '/admin/announcements/preview', { countries: ['EG'] }, a);
    expect(pv.json).toMatchObject({ businesses: 1, devices: 1, push: 1 });

    c.advance(1000);
    const s = await c.call('POST', '/admin/announcements', { titleAr: 'عرض مصر', bodyAr: 'خصم على الباقة السنوية', url: '/settings/subscription', target: { countries: ['EG'] } }, a);
    expect(s.status).toBe(201);
    expect(s.json).toMatchObject({ businesses: 1, devices: 1, pushSent: 1 });
    expect(pushed[0]).toEqual([expect.objectContaining({ to: 'ExponentPushToken[eg]', title: 'عرض مصر', data: { kind: 'announcement', id: s.json.id, url: '/settings/subscription' } })]);

    c.advance(1000);
    const all = await c.call('POST', '/admin/announcements', { titleAr: 'للكل', bodyAr: 'صيانة الليلة', target: { all: true }, push: false }, a);
    expect(all.json.pushSent).toBe(0);
    c.advance(1000);
    const gone = await c.call('POST', '/admin/announcements', { titleAr: 'اتلغى', bodyAr: 'مش هيوصل', target: { all: true }, push: false }, a);
    expect((await c.call('POST', `/admin/announcements/${gone.json.id}/cancel`, {}, a)).status).toBe(200);

    // EG check-in: both live announcements, in order; next check-in: nothing again.
    c.advance(DAY_MS);
    const r1 = await c.call('POST', '/v1/checkin', { refreshToken: eg.refresh, deviceId: eg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r1.json.announcements.map((x: any) => x.titleAr)).toEqual(['عرض مصر', 'للكل']);
    expect(r1.json.announcements[0].url).toBe('/settings/subscription');
    c.advance(DAY_MS);
    const r2 = await c.call('POST', '/v1/checkin', { refreshToken: r1.json.refreshToken, deviceId: eg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r2.json.announcements).toEqual([]);

    // SA phone: only the "all" one.
    const r3 = await c.call('POST', '/v1/checkin', { refreshToken: sa.refresh, deviceId: sa.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r3.json.announcements.map((x: any) => x.titleAr)).toEqual(['للكل']);

    // admin sessions are short; log in again two days later
    const login2 = await c.call('POST', '/admin/login', { email: 'notify@x.io', password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
    const a2 = { Authorization: `Bearer ${login2.json.token}` };
    const list = await c.call('GET', '/admin/announcements', undefined, a2);
    const byTitle = Object.fromEntries(list.json.announcements.map((x: any) => [x.title_ar, x]));
    expect(byTitle['عرض مصر']).toMatchObject({ push_sent: 1, delivered: 1 });
    expect(byTitle['للكل'].delivered).toBe(2);
    expect(byTitle['اتلغى'].cancelled_at).toBeTruthy();
    const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM admin_audit WHERE action IN ('announce','announce_cancel')`).first<any>();
    expect(n.n).toBe(4);
  });

  it('expired announcements are not delivered; a phone activated later does not get old news', async () => {
    const c = makeClient(1_800_000_000_000, { push: async (_e, m) => [m.length, 0] });
    const a = await admin(c, 'notify2@x.io');
    await c.call('POST', '/admin/announcements', { titleAr: 'قديم', bodyAr: 'يوم واحد', target: { all: true }, days: 1 }, a);
    c.advance(40 * DAY_MS);
    await c.call('POST', '/admin/announcements', { titleAr: 'قديم ٢', bodyAr: 'شهرين', target: { all: true }, days: 60 }, a);
    c.advance(20 * DAY_MS);
    const s = await shop(c, '01055555553');
    c.advance(DAY_MS);
    const r = await c.call('POST', '/v1/checkin', { refreshToken: s.refresh, deviceId: s.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r.json.announcements).toEqual([]);
  });
});
