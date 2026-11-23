import { describe, expect, it } from 'vitest';
import { OTP_POLICY } from '@daftarak/shared';
import { ConsoleProvider } from '../src/otp/providers';
import { makeClient, device } from './helpers';

const MIN = 60_000;

describe('OTP request rules', () => {
  it('rejects numbers outside EG/SA', async () => {
    const c = makeClient();
    const r = await c.call('POST', '/v1/auth/otp/request', { phone: '+447911123456' });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('invalid_phone');
  });

  it('sends a 6-digit code and stores only a hash', async () => {
    const c = makeClient();
    const r = await c.call('POST', '/v1/auth/otp/request', { phone: '01011111111' });
    expect(r.status).toBe(200);
    expect(r.json.phone).toBe('201011111111');
    const code = ConsoleProvider.lastCodeFor('201011111111')!;
    expect(code).toMatch(/^\d{6}$/);
    const row = await c.env.DB.prepare('SELECT code_hash, expires_at, created_at FROM otp_codes WHERE phone = ?1').bind('201011111111').first<any>();
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.expires_at - row.created_at).toBe(5 * MIN);
  });

  it('enforces the 60 s resend cooldown', async () => {
    const c = makeClient();
    await c.call('POST', '/v1/auth/otp/request', { phone: '01011111112' });
    c.advance(30_000);
    const r = await c.call('POST', '/v1/auth/otp/request', { phone: '01011111112' });
    expect(r.status).toBe(429);
    expect(r.json.error.code).toBe('otp_cooldown');
    expect(r.json.error.retryAfterMs).toBe(30_000);
    c.advance(30_000);
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01011111112' })).status).toBe(200);
  });

  it('caps codes per phone per hour', async () => {
    const c = makeClient();
    for (let i = 0; i < OTP_POLICY.maxPerPhonePerHour; i++) {
      expect((await c.call('POST', '/v1/auth/otp/request', { phone: '0501234567' })).status).toBe(200);
      c.advance(61_000);
    }
    const r = await c.call('POST', '/v1/auth/otp/request', { phone: '0501234567' });
    expect(r.json.error.code).toBe('otp_rate_limited');
    c.advance(60 * MIN);
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '0501234567' })).status).toBe(200);
  });

  it('caps codes per phone per day', async () => {
    const c = makeClient();
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      const r = await c.call('POST', '/v1/auth/otp/request', { phone: '0501234568' });
      if (r.status === 200) ok++;
      c.advance(13 * MIN); // ≤ 5/hour, so only the daily cap stops it
    }
    expect(ok).toBe(OTP_POLICY.maxPerPhonePerDay);
  });

  it('caps codes per IP per hour', async () => {
    const c = makeClient();
    c.setIp('10.9.9.9');
    let last = 0;
    for (let i = 0; i < OTP_POLICY.maxPerIpPerHour + 1; i++) {
      last = (await c.call('POST', '/v1/auth/otp/request', { phone: `0101000${String(i).padStart(4, '0')}` })).status;
    }
    expect(last).toBe(429);
    c.setIp('10.9.9.10');
    expect((await c.call('POST', '/v1/auth/otp/request', { phone: '01019999999' })).status).toBe(200);
  });
});

describe('OTP verify rules', () => {
  it('accepts the right code once', async () => {
    const c = makeClient();
    await c.call('POST', '/v1/auth/otp/request', { phone: '01022222222' });
    const code = ConsoleProvider.lastCodeFor('201022222222')!;
    const ok = await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222222', code, device: device() });
    expect(ok.status).toBe(200);
    expect(ok.json.accessToken).toBeTruthy();
    const again = await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222222', code, device: device() });
    expect(again.status).toBe(400);
  });

  it('expires after 5 minutes', async () => {
    const c = makeClient();
    await c.call('POST', '/v1/auth/otp/request', { phone: '01022222223' });
    const code = ConsoleProvider.lastCodeFor('201022222223')!;
    c.advance(5 * MIN + 1);
    const r = await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222223', code, device: device() });
    expect(r.json.error.code).toBe('otp_expired');
  });

  it('locks the code after 5 wrong attempts, even if the 6th is right', async () => {
    const c = makeClient();
    await c.call('POST', '/v1/auth/otp/request', { phone: '01022222224' });
    const code = ConsoleProvider.lastCodeFor('201022222224')!;
    const wrong = code === '000000' ? '111111' : '000000';
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222224', code: wrong, device: device() })).json.error.code);
    expect(codes.slice(0, 4)).toEqual(['otp_invalid', 'otp_invalid', 'otp_invalid', 'otp_invalid']);
    expect(codes[4]).toBe('otp_too_many_attempts');
    const r = await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222224', code, device: device() });
    expect(r.json.error.code).toBe('otp_too_many_attempts');
  });

  it('only the newest code is valid', async () => {
    const c = makeClient();
    await c.call('POST', '/v1/auth/otp/request', { phone: '01022222225' });
    const first = ConsoleProvider.lastCodeFor('201022222225')!;
    c.advance(61_000);
    await c.call('POST', '/v1/auth/otp/request', { phone: '01022222225' });
    const second = ConsoleProvider.lastCodeFor('201022222225')!;
    if (first !== second) {
      expect((await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222225', code: first, device: device() })).status).toBe(400);
    }
    expect((await c.call('POST', '/v1/auth/otp/verify', { phone: '01022222225', code: second, device: device() })).status).toBe(200);
  });
});

describe('SMS Misr normal SMS (no template)', () => {
  it('posts the form with Arabic text and treats 1901 as sent', async () => {
    const { SmsMisrSmsProvider } = await import('../src/otp/providers');
    const calls: { url: string; body: string }[] = [];
    const ok = new SmsMisrSmsProvider({ baseUrl: 'https://smsmisr.com/api/SMS/', environment: '1', username: 'u', password: 'p', sender: 'tok' }, (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ code: '1901', SMSID: '9' }));
    }) as unknown as typeof fetch);
    expect(await ok.send('201012345678', '482913', 'ar')).toEqual({ ok: true, providerRef: '1901' });
    const f = new URLSearchParams(calls[0]!.body);
    expect(calls[0]!.url).toBe('https://smsmisr.com/api/SMS/');
    expect(Object.fromEntries(f)).toMatchObject({ environment: '1', username: 'u', password: 'p', sender: 'tok', mobile: '201012345678', language: '2' });
    expect(f.get('message')).toContain('482913');
    expect(f.get('message')).toContain('كاشيرو');
    const bad = new SmsMisrSmsProvider({ baseUrl: 'x:', environment: '1', username: 'u', password: 'p', sender: 't' }, (async () => new Response(JSON.stringify({ code: '1903' }))) as unknown as typeof fetch);
    expect(await bad.send('201012345678', '1', 'en')).toMatchObject({ ok: false, error: 'smsmisr-sms:200:1903' });
  });
});

describe('providers call the global fetch unbound (Workers "Illegal invocation")', () => {
  it('default fetch is not invoked with the provider as `this`', async () => {
    const { SmsMisrSmsProvider } = await import('../src/otp/providers');
    const real = globalThis.fetch;
    globalThis.fetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify({ code: '1901' })));
    } as typeof fetch;
    try {
      const p = new SmsMisrSmsProvider({ baseUrl: 'https://smsmisr.com/api/SMS/', environment: '1', username: 'u', password: 'p', sender: 't' });
      expect(await p.send('201012345678', '123456', 'ar')).toMatchObject({ ok: true });
    } finally {
      globalThis.fetch = real;
    }
  });
});
