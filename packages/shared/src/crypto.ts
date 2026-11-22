/**
 * Canonical JSON, SHA-256, base64url and Ed25519 helpers.
 * Pure TypeScript (@noble) so phone, Worker and tests produce identical bytes.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { ed25519 } from '@noble/curves/ed25519.js';

export { bytesToHex, hexToBytes, utf8ToBytes };

/**
 * Canonical JSON (RFC 8785 subset): object keys sorted by UTF-16 code units, no whitespace,
 * strings NFC-normalised, only integers allowed as numbers (money/qty are integers by design),
 * `undefined` properties dropped, `null` kept.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(value)) throw new Error(`canonicalJson: non-integer number ${value}`);
      return String(value === 0 ? 0 : value);
    case 'string':
      return JSON.stringify(value.normalize('NFC'));
    case 'object': {
      if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v === undefined ? null : v)).join(',') + ']';
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return '{' + keys.map((k) => JSON.stringify(k.normalize('NFC')) + ':' + canonicalJson(obj[k])).join(',') + '}';
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof value}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === 'string' ? utf8ToBytes(data) : data));
}

export const GENESIS_HASH = '0'.repeat(64);

/** Hash-chain link: SHA-256(canonical_json(payload) || prev_hash_hex). See PLAN.md §7.3. */
export function chainHash(payload: unknown, prevHashHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(prevHashHex)) throw new Error('prev hash must be 64 lowercase hex chars');
  return sha256Hex(canonicalJson(payload) + prevHashHex);
}

// ---- base64url ----
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]!;
  }
  return out;
}

const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

export function base64urlDecode(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) throw new Error('invalid base64url');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of s) {
    buf = (buf << 6) | B64_INDEX[c]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

/** UTF-8 decode without relying on TextDecoder (not available on every JS engine we target). */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b0 = bytes[i++]!;
    let cp: number;
    if (b0 < 0x80) cp = b0;
    else if (b0 >> 5 === 0x6) cp = ((b0 & 0x1f) << 6) | (bytes[i++]! & 0x3f);
    else if (b0 >> 4 === 0xe) cp = ((b0 & 0x0f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    else cp = ((b0 & 0x07) << 18) | ((bytes[i++]! & 0x3f) << 12) | ((bytes[i++]! & 0x3f) << 6) | (bytes[i++]! & 0x3f);
    out += String.fromCodePoint(cp);
  }
  return out;
}

// ---- Ed25519 ----
export function ed25519Sign(message: Uint8Array, secretKeyHex: string): Uint8Array {
  return ed25519.sign(message, hexToBytes(secretKeyHex));
}

export function ed25519Verify(signature: Uint8Array, message: Uint8Array, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(signature, message, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function ed25519PublicKey(secretKeyHex: string): string {
  return bytesToHex(ed25519.getPublicKey(hexToBytes(secretKeyHex)));
}

export function ed25519GenerateSecretKey(): string {
  return bytesToHex(ed25519.utils.randomSecretKey());
}
