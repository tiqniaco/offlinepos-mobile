import { describe, expect, it } from 'vitest';
import type { ShopSnapshot } from '@daftarak/shared';
import { makeClient, login, device, stepUp, BACKUP_KEY } from './helpers';

const snap = (at: number, salesMinor = 12_500): ShopSnapshot => ({
  v: 1,
  at,
  day: 20261124,
  currency: 'EGP',
  today: { salesMinor, invoices: 3, returnsMinor: 0, profitMinor: 2000, expensesMinor: 0, byMethod: [{ method: 'cash', amountMinor: salesMinor }] },
  yesterdaySalesMinor: 9000,
  month: { salesMinor: 90_000, profitMinor: 20_000, expensesMinor: 1000, purchasesMinor: 40_000 },
  receivablesMinor: 0,
  payablesMinor: 0,
  stock: { valueMinor: 500_000, low: 2, out: 1 },
  shifts: [],
  last14: [{ day: 20261124, salesMinor }],
  top: [{ name: 'شاي', qtyMilli: 2000, salesMinor: 5000 }],
  lowItems: [{ name: 'سكر', qtyMilli: 0 }],
  recent: [{ no: 'A-1', type: 'INVOICE', status: 'POSTED', at, totalMinor: salesMinor, party: null, cashier: 'أحمد' }],
});

async function setup(phone: string) {
  const c = makeClient();
  const auth = await login(c, phone);
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  const r = await c.call('POST', '/v1/businesses', { name: 'بقالة النور', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, h);
  expect(r.status).toBe(201);
  const business = r.json.business;
  const mainId = r.json.registration.deviceId as string;
  // The owner signs in on a second phone.
  c.advance(61_000);
  const auth2 = await login(c, phone, 'install-0002');
  const h2 = { Authorization: `Bearer ${auth2.accessToken}` };
  return { c, auth, h, business, mainId, auth2, h2, phoneE164: `2${phone}` };
}

describe('«موبايل متابعة» (follower phone)', () => {
  it('follow needs an SMS step-up; then the follower reads what the main phone pushed', async () => {
    const { c, auth, h, business, mainId, auth2, h2, phoneE164 } = await setup('01077770001');
    const body = { businessId: business.id, device: device('install-0002') };
    expect((await c.call('POST', '/v1/devices/follow', body, h2)).json.error.code).toBe('step_up_required');
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, phoneE164);
    const f = await c.call('POST', '/v1/devices/follow', body, h2);
    expect(f.status).toBe(201);
    const fid = f.json.deviceId as string;

    // Nothing pushed yet.
    const empty = await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${fid}`, undefined, h2);
    expect(empty.status).toBe(200);
    expect(empty.json.snapshot).toBeNull();

    const p = await c.call('POST', '/v1/snapshot', { businessId: business.id, deviceId: mainId, snapshot: snap(c.clock.now) }, h);
    expect(p.json).toEqual({ ok: true, followers: 1 });
    // At most one push per 5 minutes.
    expect((await c.call('POST', '/v1/snapshot', { businessId: business.id, deviceId: mainId, snapshot: snap(c.clock.now) }, h)).status).toBe(429);

    const g = await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${fid}`, undefined, h2);
    expect(g.json.snapshot.today.salesMinor).toBe(12_500);
    expect(g.json.businessName).toBe('بقالة النور');
    expect(g.json.mainSeenAt).toBe(c.clock.now);


    const ci = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: mainId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(ci.json.followers).toBe(1);

    const list = await c.call('GET', `/v1/devices?businessId=${business.id}`, undefined, h);
    expect(list.json.devices.map((d: any) => d.role)).toEqual(['main', 'follower']);
    expect(list.json.devices[0].current).toBe(true);
  });

  it('roles are enforced: a follower never checks in or pushes; the main phone never reads; a device id alone is useless', async () => {
    const { c, h, business, mainId, auth2, h2, phoneE164 } = await setup('01077770002');
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, phoneE164);
    const fid = (await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0002') }, h2)).json.deviceId;
    const ci = await c.call('POST', '/v1/checkin', { refreshToken: auth2.refreshToken, deviceId: fid, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(ci.json.error.code).toBe('wrong_device_role');
    expect((await c.call('POST', '/v1/snapshot', { businessId: business.id, deviceId: fid, snapshot: snap(c.clock.now) }, h2)).json.error.code).toBe('wrong_device_role');
    expect((await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${mainId}`, undefined, h)).json.error.code).toBe('wrong_device_role');
    // The main phone's session cannot read through the follower's id either.
    expect((await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${fid}`, undefined, h)).json.error.code).toBe('wrong_device_role');
    // The phone that runs the shop cannot also follow it.
    c.advance(61_000);
    const self = await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0001') }, h);
    expect(self.status).toBe(403); // no step-up on the main session yet
  });

  it('the plan devices limit (with a super-admin override) caps phones; stopping a follower frees the slot', async () => {
    const { c, h, business, auth2, h2, phoneE164 } = await setup('01077770003');
    await c.env.DB.prepare(`INSERT INTO business_limit_overrides (business_id, limit_key, value, set_at) VALUES (?1, 'devices', 1, 0)`).bind(business.id).run();
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, phoneE164);
    const no = await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0002') }, h2);
    expect(no.status).toBe(403);
    expect(no.json.error).toMatchObject({ code: 'limit_reached', key: 'devices', limit: 1, used: 1 });

    await c.env.DB.prepare(`UPDATE business_limit_overrides SET value = 2 WHERE business_id = ?1`).bind(business.id).run();
    const ok = await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0002') }, h2);
    expect(ok.status).toBe(201);
    // Following again from the same phone replaces its row (no second slot).
    const again = await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0002') }, h2);
    expect(again.status).toBe(201);
    const old = await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${ok.json.deviceId}`, undefined, h2);
    expect(old.json.error.code).toBe('device_deactivated');

    // The owner stops it from the main phone → the follower is told; the main phone is never stopped this way.
    const stop = await c.call('POST', `/v1/devices/${again.json.deviceId}/stop`, { businessId: business.id }, h);
    expect(stop.json).toEqual({ ok: true });
    expect((await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${again.json.deviceId}`, undefined, h2)).json.error.code).toBe('device_deactivated');
    const main = (await c.call('GET', `/v1/devices?businessId=${business.id}`, undefined, h)).json.devices[0];
    expect((await c.call('POST', `/v1/devices/${main.id}/stop`, { businessId: business.id }, h)).status).toBe(404);
    // No follower left: the main phone's push is not stored.
    c.advance(6 * 60_000);
    const mainId = main.id;
    expect((await c.call('POST', '/v1/snapshot', { businessId: business.id, deviceId: mainId, snapshot: snap(c.clock.now) }, h)).json).toEqual({ ok: false, followers: 0 });
  });

  it('moving the shop to a new main phone keeps followers following', async () => {
    const { c, business, auth2, h2, phoneE164 } = await setup('01077770004');
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, phoneE164);
    const fid = (await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0002') }, h2)).json.deviceId;
    c.advance(61_000);
    const auth3 = await login(c, '01077770004', 'install-0003');
    c.advance(61_000);
    await stepUp(c, auth3.accessToken, '201077770004');
    const a = await c.call('POST', '/v1/devices/attach', { businessId: business.id, device: device('install-0003') }, { Authorization: `Bearer ${auth3.accessToken}` });
    expect(a.status).toBe(200);
    expect((await c.call('GET', `/v1/snapshot?businessId=${business.id}&deviceId=${fid}`, undefined, h2)).status).toBe(200);
    const roles = (await c.call('GET', `/v1/devices?businessId=${business.id}`, undefined, h2)).json.devices.map((d: any) => [d.role, d.current]);
    expect(roles).toEqual([['main', false], ['follower', true]]);
  });

  it('rejects an oversized or malformed snapshot', async () => {
    const { c, h, business, mainId, auth2, h2, phoneE164 } = await setup('01077770005');
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, phoneE164);
    await c.call('POST', '/v1/devices/follow', { businessId: business.id, device: device('install-0002') }, h2);
    const big = snap(c.clock.now);
    (big as any).pad = 'x'.repeat(60_000);
    expect((await c.call('POST', '/v1/snapshot', { businessId: business.id, deviceId: mainId, snapshot: big }, h)).status).toBe(413);
    expect((await c.call('POST', '/v1/snapshot', { businessId: business.id, deviceId: mainId, snapshot: { v: 2 } }, h)).status).toBe(400);
  });
});
