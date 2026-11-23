import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers';

describe('in-app updates', () => {
  it('latest release, forced minimum, APK download from R2', async () => {
    const c = makeClient();
    expect((await c.call('GET', '/v1/app/latest?platform=android')).json).toEqual({ latest: null, minCode: 0, channel: 'sideload' });
    const ins = (code: number, forced: number, key: string | null) =>
      c.env.DB.prepare(`INSERT INTO app_releases (id, platform, version_code, version_name, file_key, sha256, size, notes_ar, forced, created_at) VALUES (?1, 'android', ?2, ?3, ?4, 'ab', 3, 'تحسينات', ?5, 1)`)
        .bind(`r${code}`, code, `1.0.${code}`, key, forced)
        .run();
    await ins(100, 1, 'releases/kashiro-100.apk');
    await ins(120, 0, 'releases/kashiro-120.apk');
    const r = (await c.call('GET', '/v1/app/latest?platform=android')).json;
    expect(r.minCode).toBe(100);
    expect(r.latest).toMatchObject({ code: 120, name: '1.0.120', notesAr: 'تحسينات' });
    expect(r.latest.url).toMatch(/\/v1\/app\/download\/kashiro-120\.apk$/);
    await c.env.BACKUPS.put('releases/kashiro-120.apk', 'APK');
    const res = await (await import('../src/index')).createApp({ now: () => Date.now(), provider: () => ({ name: 'x', send: async () => ({ ok: true }) }) }).request('/v1/app/download/kashiro-120.apk', {}, c.env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(await res.text()).toBe('APK');
    expect((await c.call('GET', '/v1/app/download/..%2Fsecret.apk')).status).toBe(404);
  });

  it('channels + forced-update grace (force_after, default 48 h after publishing)', async () => {
    const t0 = 1_800_000_000_000;
    const c = makeClient(t0);
    const ins = (id: string, code: number, channel: string, forced: number, created: number, forceAfter: number | null, url: string | null) =>
      c.env.DB.prepare(`INSERT INTO app_releases (id, platform, version_code, version_name, file_key, url, forced, created_at, channel, force_after) VALUES (?1, 'android', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
        .bind(id, code, `2.0.${code}`, channel === 'sideload' ? `releases/kashiro-${code}.apk` : null, url, forced, created, channel, forceAfter)
        .run();
    await ins('s1', 200, 'sideload', 1, t0 - 3 * 86_400_000, null, null); // forced long ago → enforced
    await ins('s2', 210, 'sideload', 1, t0 - 3_600_000, null, null); // forced 1 h ago → still optional
    await ins('p1', 205, 'store', 0, t0, null, 'https://play.google.com/store/apps/details?id=app.daftarak');
    const side = (await c.call('GET', '/v1/app/latest?platform=android')).json;
    expect(side).toMatchObject({ minCode: 200, pendingMinCode: 210, channel: 'sideload', latest: { code: 210 } });
    expect(side.forceAt).toBe(t0 - 3_600_000 + 48 * 3_600_000);
    const store = (await c.call('GET', '/v1/app/latest?platform=android&channel=store')).json;
    expect(store).toMatchObject({ minCode: 0, channel: 'store', latest: { code: 205, url: 'https://play.google.com/store/apps/details?id=app.daftarak' } });
    c.advance(48 * 3_600_000);
    expect((await c.call('GET', '/v1/app/latest?platform=android')).json.minCode).toBe(210);
  });
});
