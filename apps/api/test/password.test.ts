import { describe, expect, it } from 'vitest';
import { passwordProblem } from '@daftarak/shared';
import { makeClient, login, device } from './helpers';

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('password policy', () => {
  it('needs 8+ chars with a letter and a digit (Arabic letters/digits count)', () => {
    expect(passwordProblem('abc123')).toBe('short');
    expect(passwordProblem('12345678')).toBe('letter');
    expect(passwordProblem('abcdefgh')).toBe('digit');
    expect(passwordProblem('Shop2026ok')).toBeNull();
    expect(passwordProblem('Password123')).toBe('common');
    expect(passwordProblem('دفترك٢٠٢٦ok')).toBeNull();
    expect(passwordProblem('abcd1234')).toBe('common');
  });
});

describe('phone + password login', () => {
  it('SMS sign-up → set password → login with password on another phone; wrong/unknown give the same error', async () => {
    const c = makeClient();
    const a = await login(c, '01066666661', 'install-a');
    expect(a.account.hasPassword).toBe(false);
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'short1' }, bearer(a.accessToken))).json.error.code).toBe('password_weak');
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'Daftar2026' }, bearer(a.accessToken))).status).toBe(200);

    const bad = await c.call('POST', '/v1/auth/password/login', { phone: '01066666661', password: 'Wrong2026', device: device('install-b') });
    const unknown = await c.call('POST', '/v1/auth/password/login', { phone: '01066666669', password: 'Daftar2026', device: device('install-b') });
    expect([bad.status, bad.json.error.code]).toEqual([401, 'invalid_credentials']);
    expect([unknown.status, unknown.json.error.code]).toEqual([401, 'invalid_credentials']);

    const ok = await c.call('POST', '/v1/auth/password/login', { phone: '+20 106 666 6661', password: 'Daftar2026', device: device('install-b') });
    expect(ok.status).toBe(200);
    expect(ok.json.account).toMatchObject({ phone: '201066666661', hasPassword: true });
    expect(ok.json.refreshToken).toBeTruthy();
  });

  it('a password-login session cannot change the password without the current one; a change signs out other phones', async () => {
    const c = makeClient();
    const a = await login(c, '01066666662', 'install-a');
    await c.call('POST', '/v1/auth/password/set', { password: 'First2026x' }, bearer(a.accessToken));
    const b = (await c.call('POST', '/v1/auth/password/login', { phone: '01066666662', password: 'First2026x', device: device('install-b') })).json;
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'Second2026x' }, bearer(b.accessToken))).json.error.code).toBe('step_up_required');
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'Second2026x', currentPassword: 'nope1234' }, bearer(b.accessToken))).json.error.code).toBe('invalid_credentials');
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'Second2026x', currentPassword: 'First2026x' }, bearer(b.accessToken))).status).toBe(200);
    // phone A is signed out; phone B keeps working
    expect((await c.call('POST', '/v1/auth/refresh', { refreshToken: a.refreshToken })).json.error.code).toBe('session_revoked');
    expect((await c.call('POST', '/v1/auth/refresh', { refreshToken: b.refreshToken })).status).toBe(200);
    expect((await c.call('POST', '/v1/auth/password/login', { phone: '01066666662', password: 'Second2026x', device: device('install-c') })).status).toBe(200);
  });

  it('forgot password: SMS code opens a 10-minute window to set a new one', async () => {
    const c = makeClient();
    const a = await login(c, '01066666663', 'install-a');
    await c.call('POST', '/v1/auth/password/set', { password: 'Old2026pass' }, bearer(a.accessToken));
    c.advance(61_000);
    const r = await login(c, '01066666663', 'install-b'); // forgot → new SMS login
    expect(r.account.hasPassword).toBe(true);
    c.advance(11 * 60_000);
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'New2026pass' }, bearer((await c.call('POST', '/v1/auth/refresh', { refreshToken: r.refreshToken })).json.accessToken))).json.error.code).toBe('step_up_required');
    c.advance(61_000);
    const r2 = await login(c, '01066666663', 'install-c');
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'New2026pass' }, bearer(r2.accessToken))).status).toBe(200);
    expect((await c.call('POST', '/v1/auth/password/login', { phone: '01066666663', password: 'Old2026pass', device: device('install-x') })).status).toBe(401);
    expect((await c.call('POST', '/v1/auth/password/login', { phone: '01066666663', password: 'New2026pass', device: device('install-x') })).status).toBe(200);
  });

  it('5 wrong passwords lock the account for 15 minutes, even with the right one', async () => {
    const c = makeClient();
    const a = await login(c, '01066666664', 'install-a');
    await c.call('POST', '/v1/auth/password/set', { password: 'Lock2026me' }, bearer(a.accessToken));
    for (let i = 0; i < 4; i++) expect((await c.call('POST', '/v1/auth/password/login', { phone: '01066666664', password: `bad${i}xxxx1`, device: device('install-x') })).status).toBe(401);
    const fifth = await c.call('POST', '/v1/auth/password/login', { phone: '01066666664', password: 'bad5xxxx1', device: device('install-x') });
    expect([fifth.status, fifth.json.error.code]).toEqual([429, 'password_locked']);
    expect((await c.call('POST', '/v1/auth/password/login', { phone: '01066666664', password: 'Lock2026me', device: device('install-x') })).json.error.code).toBe('password_locked');
    c.advance(16 * 60_000);
    expect((await c.call('POST', '/v1/auth/password/login', { phone: '01066666664', password: 'Lock2026me', device: device('install-x') })).status).toBe(200);
  });

  it('an SMS-only account answers like a wrong password (no account enumeration; the app hints at SMS login)', async () => {
    const c = makeClient();
    await login(c, '01066666665', 'install-a');
    const r = await c.call('POST', '/v1/auth/password/login', { phone: '01066666665', password: 'Any2026pass', device: device('install-x') });
    expect([r.status, r.json.error.code]).toEqual([401, 'invalid_credentials']);
  });
});

describe('licence public key endpoint', () => {
  it('returns the kid and the public half of the signing key', async () => {
    const c = makeClient();
    const r = await c.call('GET', '/v1/licence/public-key');
    expect(r.status).toBe(200);
    expect(r.json.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(r.json.kid).toBeTruthy();
  });
});

describe('client error reports', () => {
  it('stores a report and caps per IP', async () => {
    const c = makeClient();
    for (let i = 0; i < 22; i++) expect((await c.call('POST', '/v1/client-errors', { where: 'main', message: `boom ${i}`, stack: 'at Home', appVersion: '1.0.0', platform: 'android' })).status).toBe(200);
    const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM client_errors`).first<any>();
    expect(n.n).toBe(20);
  });
});
