import { describe, expect, it } from 'vitest';
import { ANNOUNCE_URLS, announceSchema, cairoTime } from '../src/announce/announce';
import type { PushMessage } from '../src/announce/announce';
import { makeClient, login, device, stepUp, BACKUP_KEY } from './helpers';

async function onboard(c: ReturnType<typeof makeClient>, phone: string) {
  const auth = await login(c, phone);
  const r = await c.call('POST', '/v1/businesses', { name: 'بقالة النور', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, { Authorization: `Bearer ${auth.accessToken}` });
  expect(r.status).toBe(201);
  return { auth, reg: r.json.registration, business: r.json.business };
}

const alerts = (c: ReturnType<typeof makeClient>, businessId: string) =>
  c.env.DB.prepare(`SELECT * FROM announcements WHERE created_by = 'system:new_device' AND json_extract(target_json, '$.businessIds[0]') = ?1`).bind(businessId).all<any>().then((r) => r.results);

describe('new-device sign-in alert', () => {
  it('Cairo time with Latin digits; /settings/sessions is an allowed announcement link', () => {
    // 2026-11-24 12:05 UTC = 14:05 in Cairo (UTC+2 in winter)
    expect(cairoTime(Date.UTC(2026, 10, 24, 12, 5))).toBe('24/11/2026 14:05');
    expect(ANNOUNCE_URLS).toContain('/settings/sessions');
    expect(announceSchema.safeParse({ titleAr: 'تنبيه', bodyAr: 'جهاز جديد', url: '/settings/sessions', target: { all: true } }).success).toBe(true);
  });

  it('attach on a new phone → targeted announcement to the shop, push to the old phone, inbox copy on the old phone only', async () => {
    const pushed: PushMessage[][] = [];
    const c = makeClient(1_800_000_000_000, { push: async (_e, m) => (pushed.push(m), [m.length, 0]) });
    const { auth, reg, business } = await onboard(c, '01066660001');
    // No alert for the very first phone of a new shop.
    expect(await alerts(c, business.id)).toHaveLength(0);
    const ci = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, pushToken: 'ExponentPushToken[old]' });
    expect(ci.status).toBe(200);

    c.advance(61_000);
    const auth2 = await login(c, '01066660001', 'install-0009');
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, '201066660001');
    const a = await c.call('POST', '/v1/devices/attach', { businessId: business.id, device: { ...device('install-0009'), model: 'Galaxy A15' } }, { Authorization: `Bearer ${auth2.accessToken}` });
    expect(a.status).toBe(200);

    const rows = await alerts(c, business.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('/settings/sessions');
    expect(rows[0].body_ar).toBe(`اتسجل دخول على حسابك من جهاز جديد: Galaxy A15 — ${cairoTime(c.clock.now)}. لو مش إنت، افتح «الأجهزة المسجل عليها» واقفل الجلسة وغيّر كلمة السر.`);
    expect(rows[0].body_ar).not.toMatch(/[٠-٩]/);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toEqual([expect.objectContaining({ to: 'ExponentPushToken[old]', data: { kind: 'announcement', id: rows[0].id, url: '/settings/sessions' } })]);

    // The old phone gets it in its inbox with the next check-in…
    c.advance(1000);
    const old = await c.call('POST', '/v1/checkin', { refreshToken: ci.json.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(old.json.announcements.map((x: any) => x.url)).toEqual(['/settings/sessions']);
    // …the new phone does not get its own alert.
    const mine = await c.call('POST', '/v1/checkin', { refreshToken: auth2.refreshToken, deviceId: a.json.registration.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(mine.status).toBe(200);
    expect(mine.json.announcements).toEqual([]);

    // Re-attaching a phone that was registered on this shop before is not a new device.
    c.advance(61_000);
    const auth3 = await login(c, '01066660001', 'install-0001');
    c.advance(61_000);
    await stepUp(c, auth3.accessToken, '201066660001');
    const back = await c.call('POST', '/v1/devices/attach', { businessId: business.id, device: device('install-0001') }, { Authorization: `Bearer ${auth3.accessToken}` });
    expect(back.status).toBe(200);
    expect(await alerts(c, business.id)).toHaveLength(1);
  });

  it('activate after a restore on a new phone → alert too', async () => {
    const c = makeClient();
    const { business } = await onboard(c, '01066660002');
    c.advance(61_000);
    const auth2 = await login(c, '01066660002', 'install-0002');
    const h2 = { Authorization: `Bearer ${auth2.accessToken}` };
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, '201066660002');
    const r = await c.call('POST', '/v1/devices/activate', { businessId: business.id, device: device('install-0002') }, h2);
    expect(r.status).toBe(200);
    const rows = await alerts(c, business.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].body_ar).toContain('جهاز جديد: Pixel — ');
    expect(JSON.parse(rows[0].target_json)).toEqual({ businessIds: [business.id], exceptDeviceIds: [r.json.registration.deviceId] });
  });
});
