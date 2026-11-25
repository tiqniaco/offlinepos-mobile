import { describe, expect, it } from 'vitest';
import { makeClient, login, device, stepUp, BACKUP_KEY } from './helpers';

const SHA = 'b'.repeat(64);

describe('delete account from the app', () => {
  it('needs a fresh SMS step-up, then removes the account, its shop, backups (with R2 objects) and sessions', async () => {
    const c = makeClient();
    const auth = await login(c, '01055555551');
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    const shop = await c.call('POST', '/v1/businesses', { name: 'بقالة', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, h);
    expect(shop.status).toBe(201);
    const bid = shop.json.business.id;
    const u = await c.call('POST', '/v1/backups/upload-url', { businessId: bid, deviceId: shop.json.registration.deviceId, meta: { size: 3, sha256: SHA, counts: {}, schemaVersion: 11 } }, h);
    expect(u.status).toBe(200);
    const key = new URL(u.json.url).pathname.split('/').slice(2).join('/');
    await c.env.BACKUPS.put(key, 'abc');

    // Without a step-up: refused, nothing deleted.
    const refused = await c.call('POST', '/v1/account/delete', {}, h);
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe('step_up_required');

    c.advance(61_000);
    await stepUp(c, auth.accessToken, '201055555551');
    const ok = await c.call('POST', '/v1/account/delete', {}, h);
    expect(ok.status).toBe(200);
    expect(ok.json.deletedBusinesses).toBe(1);

    const one = (sql: string, ...b: unknown[]) => c.env.DB.prepare(sql).bind(...b).first<{ n: number }>().then((r) => r?.n);
    expect(await one(`SELECT COUNT(*) AS n FROM accounts WHERE phone = ?1`, '201055555551')).toBe(0);
    expect(await one(`SELECT COUNT(*) AS n FROM businesses WHERE id = ?1`, bid)).toBe(0);
    expect(await one(`SELECT COUNT(*) AS n FROM devices WHERE business_id = ?1`, bid)).toBe(0);
    expect(await one(`SELECT COUNT(*) AS n FROM backups WHERE business_id = ?1`, bid)).toBe(0);
    expect(await c.env.BACKUPS.get(key)).toBeNull();
    // The old token no longer works, and the number can sign up again as a new account.
    expect((await c.call('POST', '/v1/auth/step-up/request', {}, h)).status).toBe(401);
    c.advance(61_000);
    const again = await login(c, '01055555551', 'install-0002');
    expect(again.businesses).toEqual([]);
  });

  it("does not touch another account's shop", async () => {
    const c = makeClient();
    const a = await login(c, '01055555552');
    const b = await login(c, '01055555553', 'install-0003');
    const hb = { Authorization: `Bearer ${b.accessToken}` };
    const shopB = await c.call('POST', '/v1/businesses', { name: 'محل', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device('install-0003') }, hb);
    expect(shopB.status).toBe(201);
    c.advance(61_000);
    await stepUp(c, a.accessToken, '201055555552');
    expect((await c.call('POST', '/v1/account/delete', {}, { Authorization: `Bearer ${a.accessToken}` })).status).toBe(200);
    const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM businesses WHERE id = ?1`).bind(shopB.json.business.id).first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
