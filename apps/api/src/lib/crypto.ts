/** Server-side crypto helpers on WebCrypto (available in Workers). */
import { base64urlDecode, base64urlEncode, bytesToHex, utf8ToBytes } from '@daftarak/shared';

export function randomToken(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64urlEncode(b);
}

/** Uniform random 6-digit numeric code (rejection sampling, no modulo bias). */
export function randomDigits(n = 6): string {
  const max = 10 ** n;
  const limit = Math.floor(0xffffffff / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return String(buf[0]! % max).padStart(n, '0');
  }
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, utf8ToBytes(message));
  return bytesToHex(new Uint8Array(sig));
}

export async function sha256HexAsync(message: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', utf8ToBytes(message));
  return bytesToHex(new Uint8Array(d));
}

/** Constant-time string comparison (same length hex strings). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** PBKDF2-SHA256. Workers cap iterations at 100,000. */
export const PBKDF2_ITERATIONS = 100_000;
export async function pbkdf2Hex(password: string, saltHex: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', utf8ToBytes(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function wrapKey(keyB64: string) {
  return crypto.subtle.importKey('raw', new Uint8Array(base64urlDecode(keyB64)), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** AES-256-GCM wrap of a secret (used for the per-business backup key). Output "iv.ciphertext" base64url. */
export async function wrapSecret(plain: Uint8Array, wrapKeyB64: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(wrapKeyB64), new Uint8Array(plain));
  return `${base64urlEncode(iv)}.${base64urlEncode(new Uint8Array(ct))}`;
}

export async function unwrapSecret(wrapped: string, wrapKeyB64: string): Promise<Uint8Array> {
  const [iv, ct] = wrapped.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(base64urlDecode(iv!)) }, await wrapKey(wrapKeyB64), new Uint8Array(base64urlDecode(ct!)));
  return new Uint8Array(pt);
}
