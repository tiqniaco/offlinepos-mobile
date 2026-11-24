import { describe, expect, it } from 'vitest';
import { createApp } from '../src/index';
import { ConsoleProvider } from '../src/otp/providers';
import type { Env } from '../src/env';
import { makeClient, login, device, BACKUP_KEY } from './helpers';

describe('cloud backups without R2 API keys (through the Worker)', () => {
  it('upload URL on our domain → PUT bytes → commit → download URL → same bytes; tampered or expired URLs are refused', async () => {
    const noKeys = { R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' } as Partial<Env>;
    const c = makeClient(1_800_000_000_000, {}, noKeys);
    const auth = await login(c, '01055555551');
    const h = { Authorization: `Bearer ${auth.accessToken}` };
    const r = await c.call('POST', '/v1/businesses', { name: 'بقالة', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() }, h);
    const business = r.json.business;
    const meta = { size: 5, sha256: 'b'.repeat(64), counts: {}, schemaVersion: 11 };
    const u = await c.call('POST', '/v1/backups/upload-url', { businessId: business.id, deviceId: r.json.registration.deviceId, meta }, h);
    expect(u.status).toBe(200);
    expect(u.json.url).toContain('/v1/backups/blob?');

    const app = createApp({ now: () => c.clock.now, provider: () => new ConsoleProvider() });
    const env = { ...(c.env as Env), ...noKeys };
    const path = new URL(u.json.url).pathname + new URL(u.json.url).search;
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const bad = path.replace(/sig=[0-9a-f]{4}/, 'sig=0000');
    expect((await app.request(bad, { method: 'PUT', headers: { 'Content-Length': '5' }, body: bytes }, env)).status).toBe(403);
    const put = await app.request(path, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5' }, body: bytes }, env);
    expect(put.status).toBe(200);
    expect((await c.call('POST', `/v1/backups/${u.json.backupId}/commit`, { businessId: business.id }, h)).status).toBe(200);

    const d = await c.call('POST', `/v1/backups/${u.json.backupId}/download-url`, {}, h);
    const dpath = new URL(d.json.url).pathname + new URL(d.json.url).search;
    const got = await app.request(dpath, {}, env);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);
    // A download URL cannot be used to upload, and it expires.
    expect((await app.request(dpath, { method: 'PUT', headers: { 'Content-Length': '5' }, body: bytes }, env)).status).toBe(403);
    // A longer life cannot be forged.
    expect((await app.request(dpath.replace(/exp=(\d+)/, (_m, e) => `exp=${Number(e) + 86_400_000}`), {}, env)).status).toBe(403);
  });

  it('step-up request answers with the phone the code was sent to (the app reads it)', async () => {
    const c = makeClient();
    const auth = await login(c, '01055555552');
    c.advance(61_000);
    const r = await c.call('POST', '/v1/auth/step-up/request', {}, { Authorization: `Bearer ${auth.accessToken}` });
    expect(r.json).toMatchObject({ phone: '201055555552' });
  });
});
