import { describe, expect, it } from 'vitest';
import { blocks, verifyIntegrity } from '../src/integrity/verify';
import type { Env } from '../src/env';

async function serviceAccount() {
  const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', kp.privateKey)) as ArrayBuffer);
  let bin = '';
  der.forEach((b) => (bin += String.fromCharCode(b)));
  return JSON.stringify({ client_email: 'svc@x.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----\n` });
}

const NOW = 1_900_000_000_000;
function fakeGoogle(payload: object) {
  const calls: string[] = [];
  const f = (async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'at' }));
    return new Response(JSON.stringify({ tokenPayloadExternal: payload }));
  }) as typeof fetch;
  return { f, calls };
}
const good = { requestDetails: { requestHash: 'h1', timestampMillis: NOW }, appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED' }, deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] } };

describe('device integrity', () => {
  it('Play Integrity: pass, wrong request hash, unrecognised app, rooted device', async () => {
    const env = { INTEGRITY_MODE: 'enforce', ANDROID_PACKAGE: 'app.daftarak', GOOGLE_SERVICE_ACCOUNT_JSON: await serviceAccount() } as unknown as Env;
    const input = { platform: 'android' as const, token: 'tok', requestHash: 'h1' };
    const g = fakeGoogle(good);
    expect(await verifyIntegrity(env, input, NOW, g.f)).toEqual({ status: 'pass' });
    expect(g.calls[1]).toContain('app.daftarak:decodeIntegrityToken');
    expect((await verifyIntegrity(env, { ...input, requestHash: 'other' }, NOW, fakeGoogle(good).f)).reason).toBe('request_hash');
    expect((await verifyIntegrity(env, input, NOW, fakeGoogle({ ...good, appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION' } }).f)).reason).toBe('app_not_recognized');
    const rooted = await verifyIntegrity(env, input, NOW, fakeGoogle({ ...good, deviceIntegrity: { deviceRecognitionVerdict: [] } }).f);
    expect(rooted).toEqual({ status: 'fail', reason: 'device' });
    expect(blocks(env, rooted, 'signup')).toBe(true);
    expect(blocks(env, rooted, 'checkin')).toBe(false); // never lock a shop out at check-in
  });

  it('Google calls carry a timeout signal; a timeout is "unverified" (never blocks a check-in)', async () => {
    const env = { INTEGRITY_MODE: 'enforce', ANDROID_PACKAGE: 'app.daftarak', GOOGLE_SERVICE_ACCOUNT_JSON: await serviceAccount() } as unknown as Env;
    const signals: (AbortSignal | null | undefined)[] = [];
    const hang = (async (_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      throw new DOMException('timed out', 'TimeoutError');
    }) as typeof fetch;
    const v = await verifyIntegrity(env, { platform: 'android', token: 't', requestHash: 'h1' }, NOW, hang);
    expect(v).toEqual({ status: 'unverified', reason: 'timeout' });
    expect(signals[0]).toBeInstanceOf(AbortSignal);
  });

  it('log mode never blocks; missing configuration or token is "unverified", not a failure', async () => {
    const env = { INTEGRITY_MODE: 'log' } as unknown as Env;
    const v = await verifyIntegrity(env, { platform: 'android', token: 't', requestHash: 'h' }, NOW);
    expect(v).toEqual({ status: 'unverified', reason: 'not_configured' });
    expect(blocks(env, { status: 'fail' }, 'signup')).toBe(false);
    expect((await verifyIntegrity(env, undefined, NOW)).status).toBe('unverified');
    expect((await verifyIntegrity({ INTEGRITY_MODE: 'off' } as unknown as Env, undefined, NOW)).status).toBe('skipped');
  });
});
