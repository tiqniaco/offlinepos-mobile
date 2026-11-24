import { describe, expect, it } from 'vitest';
import { makeClient, login, device, BACKUP_KEY } from './helpers';

async function shop(phone: string) {
  const c = makeClient();
  const auth = await login(c, phone);
  const h = { Authorization: `Bearer ${auth.accessToken}` };
  const r = await c.call('POST', '/v1/businesses', { name: 'بقالة النور', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, h);
  expect(r.status).toBe(201);
  return { c, auth, h, businessId: r.json.business.id as string, mainId: r.json.registration.deviceId as string };
}

async function join(s: Awaited<ReturnType<typeof shop>>, install = 'install-cash-1') {
  const inv = await s.c.call('POST', '/v1/sync/invite', { businessId: s.businessId, deviceId: s.mainId }, s.h);
  expect(inv.status).toBe(201);
  const j = await s.c.call('POST', '/v1/sync/join', { code: inv.json.code, device: device(install) });
  return { inv, j };
}

describe('cashier phones (QR join + sync)', () => {
  it('invite → join → cashier pushes sales → main pulls, acks → cashier sees them applied', async () => {
    const s = await shop('01088880001');
    const { inv, j } = await join(s);
    expect(j.status).toBe(201);
    expect(j.json).toMatchObject({ business: { id: s.businessId, name: 'بقالة النور' }, deviceCode: 'B' });
    // The code works once.
    expect((await s.c.call('POST', '/v1/sync/join', { code: inv.json.code, device: device('install-cash-2') })).json.error.code).toBe('code_invalid');

    const ch = { Authorization: `Bearer ${j.json.accessToken}` };
    const cid = j.json.deviceId as string;
    // Licence through the normal check-in (no backups for a cashier phone).
    const ci = await s.c.call('POST', '/v1/checkin', { refreshToken: j.json.refreshToken, deviceId: cid, appVersion: '0.1.0', deviceTime: s.c.clock.now, backupMeta: { size: 10, sha256: 'a'.repeat(64), counts: {}, schemaVersion: 1 } });
    expect(ci.status).toBe(200);
    expect(ci.json.backupPut).toBeNull();
    expect(typeof ci.json.licence).toBe('string');

    const push = await s.c.call('POST', '/v1/sync/ops', { deviceId: cid, ops: [{ seq: 1, data: 'AAAA' }, { seq: 2, data: 'BBBB' }] }, ch);
    expect(push.json).toEqual({ stored: 2, appliedSeq: 0 });
    // Retrying the same seqs stores nothing twice.
    expect((await s.c.call('POST', '/v1/sync/ops', { deviceId: cid, ops: [{ seq: 2, data: 'BBBB' }] }, ch)).json.stored).toBe(0);

    const pull = await s.c.call('GET', `/v1/sync/ops?businessId=${s.businessId}&deviceId=${s.mainId}`, undefined, s.h);
    expect(pull.json.ops.map((o: any) => [o.deviceCode, o.seq, o.data])).toEqual([['B', 1, 'AAAA'], ['B', 2, 'BBBB']]);
    expect((await s.c.call('POST', '/v1/sync/ops/ack', { businessId: s.businessId, deviceId: s.mainId, ids: pull.json.ops.map((o: any) => o.id) }, s.h)).json.ok).toBe(true);
    expect((await s.c.call('GET', `/v1/sync/ops?businessId=${s.businessId}&deviceId=${s.mainId}`, undefined, s.h)).json.ops).toEqual([]);
    const st = await s.c.call('GET', `/v1/sync/status?deviceId=${cid}`, undefined, ch);
    expect(st.json).toMatchObject({ appliedSeq: 2, catalogVersion: 0 });

    // The main phone learns it has a cashier phone.
    const mci = await s.c.call('POST', '/v1/checkin', { refreshToken: s.auth.refreshToken, deviceId: s.mainId, appVersion: '0.1.0', deviceTime: s.c.clock.now });
    expect(mci.json.cashiers).toBe(1);
    const list = await s.c.call('GET', `/v1/devices?businessId=${s.businessId}`, undefined, s.h);
    expect(list.json.devices.map((d: any) => d.role)).toEqual(['main', 'cashier']);
  });

  it('catalog: the main phone uploads, the cashier phone downloads the same bytes', async () => {
    const s = await shop('01088880002');
    const { j } = await join(s);
    const ch = { Authorization: `Bearer ${j.json.accessToken}` };
    expect((await s.c.call('GET', `/v1/sync/catalog?deviceId=${j.json.deviceId}`, undefined, ch)).status).toBe(404);
    const app = (await import('../src/index')).createApp({ now: () => s.c.clock.now, provider: () => ({}) as never });
    const bytes = new Uint8Array([1, 2, 3, 250]);
    const put = await app.request('/v1/sync/catalog', { method: 'PUT', headers: { ...s.h, 'X-Business-Id': s.businessId, 'X-Device-Id': s.mainId, 'Content-Type': 'application/octet-stream' }, body: bytes }, s.c.env);
    expect(put.status).toBe(200);
    const pj = (await put.json()) as { version: number; satellites: number };
    expect(pj.satellites).toBe(1);
    const get = await app.request(`/v1/sync/catalog?deviceId=${j.json.deviceId}`, { headers: ch }, s.c.env);
    expect(get.status).toBe(200);
    expect(Number(get.headers.get('X-Catalog-Version'))).toBe(pj.version);
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
    // Only the main phone uploads.
    const bad = await app.request('/v1/sync/catalog', { method: 'PUT', headers: { ...ch, 'X-Business-Id': s.businessId, 'X-Device-Id': j.json.deviceId }, body: bytes }, s.c.env);
    expect(bad.status).toBe(403);
  });

  it("a cashier phone's session reaches only the sync endpoints, and stopping the phone ends it", async () => {
    const s = await shop('01088880003');
    const { j } = await join(s);
    const ch = { Authorization: `Bearer ${j.json.accessToken}` };
    for (const [m, p, b] of [
      ['GET', '/v1/sessions', undefined],
      ['POST', '/v1/backups/key', { businessId: s.businessId }],
      ['POST', '/v1/sync/invite', { businessId: s.businessId, deviceId: s.mainId }],
      ['GET', `/v1/sync/ops?businessId=${s.businessId}&deviceId=${s.mainId}`, undefined],
    ] as const) {
      const r = await s.c.call(m, p, b, ch);
      expect([r.status, r.json.error.code]).toEqual([403, 'wrong_device_role']);
    }
    // …and the owner's session cannot act as the cashier phone.
    expect((await s.c.call('POST', '/v1/sync/ops', { deviceId: j.json.deviceId, ops: [{ seq: 1, data: 'x' }] }, s.h)).json.error.code).toBe('wrong_device_role');
    // The main phone cannot check in with the cashier phone's refresh token.
    expect((await s.c.call('POST', '/v1/checkin', { refreshToken: j.json.refreshToken, deviceId: s.mainId, appVersion: '0.1.0', deviceTime: s.c.clock.now })).json.error.code).toBe('wrong_device_role');

    const stop = await s.c.call('POST', `/v1/devices/${j.json.deviceId}/stop`, { businessId: s.businessId }, s.h);
    expect(stop.json).toEqual({ ok: true });
    // Stopped: it can still deliver the sales it made, nothing else.
    const st = await s.c.call('GET', `/v1/sync/status?deviceId=${j.json.deviceId}`, undefined, ch);
    expect(st.json.stopped).toBe(true);
    expect((await s.c.call('POST', '/v1/sync/ops', { deviceId: j.json.deviceId, ops: [{ seq: 1, data: 'late' }] }, ch)).json.stored).toBe(1);
    expect((await s.c.call('GET', `/v1/sync/catalog?deviceId=${j.json.deviceId}`, undefined, ch)).json.error.code).toBe('device_deactivated');
    // The cashier phone can sign itself out.
    expect((await s.c.call('POST', '/v1/auth/logout', {}, ch)).json.ok).toBe(true);
  });

  it('the plan devices limit caps cashier phones; expired codes are refused', async () => {
    const s = await shop('01088880004');
    await s.c.env.DB.prepare(`INSERT INTO business_limit_overrides (business_id, limit_key, value, set_at) VALUES (?1, 'devices', 2, 0)`).bind(s.businessId).run();
    const a = await join(s, 'install-a');
    expect(a.j.status).toBe(201);
    const full = await s.c.call('POST', '/v1/sync/invite', { businessId: s.businessId, deviceId: s.mainId }, s.h);
    expect(full.json.error).toMatchObject({ code: 'limit_reached', key: 'devices', limit: 2, used: 2 });

    await s.c.env.DB.prepare(`UPDATE business_limit_overrides SET value = 3 WHERE business_id = ?1`).bind(s.businessId).run();
    const inv = await s.c.call('POST', '/v1/sync/invite', { businessId: s.businessId, deviceId: s.mainId }, s.h);
    s.c.advance(16 * 60_000);
    expect((await s.c.call('POST', '/v1/sync/join', { code: inv.json.code, device: device('install-b') })).json.error.code).toBe('code_invalid');
  });

  it('applied progress has no gaps: a sale the main phone could not post keeps the cashier phone waiting', async () => {
    const s = await shop('01088880005');
    const { j } = await join(s);
    const ch = { Authorization: `Bearer ${j.json.accessToken}` };
    await s.c.call('POST', '/v1/sync/ops', { deviceId: j.json.deviceId, ops: [1, 2, 3].map((seq) => ({ seq, data: `op${seq}` })) }, ch);
    const pull = await s.c.call('GET', `/v1/sync/ops?businessId=${s.businessId}&deviceId=${s.mainId}`, undefined, s.h);
    // seq 2 failed on the main phone: only 1 and 3 are acked.
    await s.c.call('POST', '/v1/sync/ops/ack', { businessId: s.businessId, deviceId: s.mainId, ids: pull.json.ops.filter((o: any) => o.seq !== 2).map((o: any) => o.id) }, s.h);
    expect((await s.c.call('GET', `/v1/sync/status?deviceId=${j.json.deviceId}`, undefined, ch)).json.appliedSeq).toBe(1);
    // …and it is offered again.
    expect((await s.c.call('GET', `/v1/sync/ops?businessId=${s.businessId}&deviceId=${s.mainId}`, undefined, s.h)).json.ops.map((o: any) => o.seq)).toEqual([2]);
  });
});
