import { env } from 'cloudflare:workers';
import { createApp } from '../src/index';
import { ConsoleProvider } from '../src/otp/providers';
import type { Env } from '../src/env';

export const TEST_PK_SK = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';

export function makeClient(start = 1_800_000_000_000) {
  const clock = { now: start };
  const app = createApp({ now: () => clock.now, provider: () => new ConsoleProvider() });
  let ip = '10.0.0.1';
  async function call(method: string, path: string, json?: unknown, headers: Record<string, string> = {}) {
    const res = await app.request(
      path,
      {
        method,
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
        body: json === undefined ? undefined : JSON.stringify(json),
      },
      env as unknown as Env,
    );
    const text = await res.text();
    return { status: res.status, json: text ? (JSON.parse(text) as any) : null };
  }
  return {
    clock,
    call,
    setIp: (v: string) => (ip = v),
    advance: (ms: number) => (clock.now += ms),
    env: env as unknown as Env,
  };
}

export const device = (installId = 'install-0001') => ({ installId, platform: 'android' as const, model: 'Pixel', appVersion: '0.1.0' });

/** Full OTP login, returns auth response. */
export async function login(c: ReturnType<typeof makeClient>, phone = '01012345678', installId = 'install-0001') {
  const r1 = await c.call('POST', '/v1/auth/otp/request', { phone });
  if (r1.status !== 200) throw new Error(JSON.stringify(r1.json));
  const code = ConsoleProvider.lastCodeFor(r1.json.phone)!;
  const r2 = await c.call('POST', '/v1/auth/otp/verify', { phone, code, device: device(installId) });
  if (r2.status !== 200) throw new Error(JSON.stringify(r2.json));
  return r2.json;
}

export const BACKUP_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
