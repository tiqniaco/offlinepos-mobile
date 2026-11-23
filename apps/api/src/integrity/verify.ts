/**
 * Device integrity (PLAN.md Phase 7): Google Play Integrity on Android, Apple App Attest on iOS.
 * Mode (env INTEGRITY_MODE): "off" | "log" (default: record verdicts, never block) | "enforce" (block SIGN-UP and
 * device activation on a failed verdict; the daily check-in only records, so a Google/Apple outage can never
 * lock a paying shop out of its own data).
 * Android verdicts are decoded with the Play Integrity API using a Google service account (secret
 * GOOGLE_SERVICE_ACCOUNT_JSON). iOS attestation objects are stored for audit; full App Attest verification
 * (CBOR + Apple certificate chain) is a documented follow-up (PLAN.md D-56).
 */
import { base64urlEncode, utf8ToBytes } from '@daftarak/shared';
import type { Env } from '../env';

export interface IntegrityInput {
  platform: 'android' | 'ios';
  token: string;
  requestHash: string;
  keyId?: string;
}

export type IntegrityVerdict = { status: 'pass' | 'fail' | 'unverified' | 'skipped'; reason?: string };

type Fetch = typeof fetch;

export const INTEGRITY_TIMEOUT_MS = 5_000;

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** OAuth2 access token for a Google service account (JWT bearer grant, RS256 via WebCrypto). */
export async function googleAccessToken(sa: { client_email: string; private_key: string; token_uri?: string }, now: number, f: Fetch = fetch): Promise<string> {
  const header = base64urlEncode(utf8ToBytes(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const iat = Math.floor(now / 1000);
  const claims = base64urlEncode(utf8ToBytes(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/playintegrity', aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8ToBytes(`${header}.${claims}`)));
  const res = await f(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${base64urlEncode(sig)}`,
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function verifyIntegrity(env: Env, input: IntegrityInput | undefined, now: number, f: Fetch = fetch): Promise<IntegrityVerdict> {
  const mode = env.INTEGRITY_MODE ?? 'log';
  if (mode === 'off') return { status: 'skipped' };
  if (!input) return { status: 'unverified', reason: 'no_token' };
  if (input.platform === 'ios') return { status: 'unverified', reason: 'app_attest_recorded' };
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON || !env.ANDROID_PACKAGE) return { status: 'unverified', reason: 'not_configured' };
  // Google must never hold a check-in hostage: each call gets 5 s, a timeout is just "unverified".
  const timed: Fetch = (url, init) => f(url, { ...init, signal: AbortSignal.timeout(INTEGRITY_TIMEOUT_MS) });
  try {
    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string; token_uri?: string };
    const at = await googleAccessToken(sa, now, timed);
    const res = await timed(`https://playintegrity.googleapis.com/v1/${env.ANDROID_PACKAGE}:decodeIntegrityToken`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ integrity_token: input.token }),
    });
    if (!res.ok) return { status: 'unverified', reason: `decode_${res.status}` };
    const p = ((await res.json()) as { tokenPayloadExternal?: Record<string, any> }).tokenPayloadExternal ?? {};
    if (p.requestDetails?.requestHash !== input.requestHash) return { status: 'fail', reason: 'request_hash' };
    if (Math.abs(now - Number(p.requestDetails?.timestampMillis ?? 0)) > 10 * 60_000) return { status: 'fail', reason: 'stale' };
    if (p.appIntegrity?.appRecognitionVerdict !== 'PLAY_RECOGNIZED') return { status: 'fail', reason: 'app_not_recognized' };
    if (!(p.deviceIntegrity?.deviceRecognitionVerdict ?? []).includes('MEETS_DEVICE_INTEGRITY')) return { status: 'fail', reason: 'device' };
    return { status: 'pass' };
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') return { status: 'unverified', reason: 'timeout' };
    return { status: 'unverified', reason: (e as Error).message.slice(0, 60) };
  }
}

/** Should this verdict block the action? Only in "enforce" mode and only for sign-up / activation. */
export function blocks(env: Env, v: IntegrityVerdict, action: 'signup' | 'activate' | 'checkin'): boolean {
  return (env.INTEGRITY_MODE ?? 'log') === 'enforce' && action !== 'checkin' && v.status === 'fail';
}
