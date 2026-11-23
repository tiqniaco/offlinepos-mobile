/**
 * PIN hashing and lock-out policy (PLAN.md §3.2). Pure functions — unit tested.
 * scrypt parameters are stored with each hash so they can be raised later without breaking old PINs.
 */
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { bytesToHex, hexToBytes, utf8ToBytes, digitsOnly } from '@daftarak/shared';

export interface PinParams {
  N: number;
  r: number;
  p: number;
}
/**
 * Cost is kept low on purpose: scrypt runs in JavaScript (Hermes, no JIT) and 2^13 took many seconds per unlock on
 * phones. The hash lives inside the SQLCipher-encrypted database (key in the secure enclave/keystore) and unlock is
 * rate-limited, so offline guessing would first need the database key. Older hashes keep their stored params and are
 * re-hashed with these on the next successful unlock.
 */
export const DEFAULT_PIN_PARAMS: PinParams = { N: 2 ** 10, r: 8, p: 1 };
export const isDefaultParams = (json: string) => {
  try {
    const p = JSON.parse(json) as PinParams;
    return p.N === DEFAULT_PIN_PARAMS.N && p.r === DEFAULT_PIN_PARAMS.r && p.p === DEFAULT_PIN_PARAMS.p;
  } catch {
    return false;
  }
};

export const PIN_MIN = 4;
export const PIN_MAX = 6;

export function isValidPin(pin: string): boolean {
  return /^\d+$/.test(pin) && pin.length >= PIN_MIN && pin.length <= PIN_MAX;
}

/** Reject PINs that are trivial to guess. */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1+$/.test(pin)) return true; // 0000, 111111
  const asc = '0123456789012345';
  const desc = '9876543210987654';
  return asc.includes(pin) || desc.includes(pin);
}

export function normalizePinInput(raw: string): string {
  return digitsOnly(raw).slice(0, PIN_MAX);
}

export async function hashPin(pin: string, saltHex?: string, params: PinParams = DEFAULT_PIN_PARAMS) {
  const salt = saltHex ?? bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  const key = await scryptAsync(utf8ToBytes(pin), hexToBytes(salt), { ...params, dkLen: 32 });
  return { hash: bytesToHex(key), salt, params: JSON.stringify(params) };
}

export async function checkPin(pin: string, user: { pinHash: string; pinSalt: string; pinParams: string }): Promise<boolean> {
  const params = JSON.parse(user.pinParams) as PinParams;
  const { hash } = await hashPin(pin, user.pinSalt, params);
  let diff = hash.length ^ user.pinHash.length;
  for (let i = 0; i < Math.min(hash.length, user.pinHash.length); i++) diff |= hash.charCodeAt(i) ^ user.pinHash.charCodeAt(i);
  return diff === 0;
}

/** 5 wrong PINs → 30 s lock, then doubling each further failure, capped at 15 min. */
export const FREE_ATTEMPTS = 5;
export function lockoutAfterFailure(failedAttempts: number, now: number): number | null {
  if (failedAttempts < FREE_ATTEMPTS) return null;
  const extra = failedAttempts - FREE_ATTEMPTS;
  const ms = Math.min(30_000 * 2 ** extra, 15 * 60_000);
  return now + ms;
}
