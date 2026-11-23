import { describe, expect, it } from 'vitest';
import { makeClient } from './helpers';

describe('in-app updates', () => {
  it('latest release, forced minimum, APK download from R2', async () => {
    const c = makeClient();
    expect((await c.call('GET', '/v1/app/latest?platform=android')).json).toEqual({ latest: null, minCode: 0 });
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
});
