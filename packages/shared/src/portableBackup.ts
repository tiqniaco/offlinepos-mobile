/**
 * Portable backup ".kashiro": the shop keeps it wherever it likes (Google Drive, Files, WhatsApp, e-mail) and can
 * restore it on any phone WITHOUT our server. Same container as the cloud ".obk" (backupCodec.ts: gzip + AES-256-GCM
 * frames whose AAD includes SHA-256 of the header), but the data key is random per file and travels in the header,
 * wrapped with a key derived from a passphrase the owner chose at export time:
 *
 *   KEK        = scrypt(NFC(passphrase), salt, N = 2^15, r = 8, p = 1, dkLen = 32)
 *   wrappedKey = AES-256-GCM(KEK, nonce, AAD = "kashiro-portable/1").encrypt(dataKey)    (32 + 16 bytes)
 *
 * The header is readable without the passphrase and holds NO customer data: business name, date, counts, schema
 * version, app version and the KDF/wrap parameters. Any change to the header makes every frame fail (AAD), and a wrong
 * passphrase fails the key unwrap before anything is decrypted.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { base64urlDecode, base64urlEncode, utf8ToBytes } from './crypto';
import { ObkError, ObkReader, ObkWriter, readObkHeader, type ObkEntryEvents } from './backupCodec';

export const PORTABLE_FORMAT = 'kashiro-portable';
export const PORTABLE_EXT = 'kashiro';
export const PORTABLE_PASSPHRASE_MIN = 8;
/** Entry carrying the business backup key (so cloud backups made later from the new phone stay restorable). */
export const PORTABLE_BACKUP_KEY_ENTRY = 'key/backup';

export interface PortableKdf {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
}
export const PORTABLE_KDF: PortableKdf = { name: 'scrypt', N: 2 ** 15, r: 8, p: 1 };

export interface PortableHeader {
  format: typeof PORTABLE_FORMAT;
  v: 1;
  kdf: PortableKdf;
  /** base64url, 16 bytes */
  salt: string;
  /** base64url, 12 bytes (nonce of the key wrap) */
  nonce: string;
  /** base64url, AES-GCM(data key) = 48 bytes */
  wrappedKey: string;
  businessName: string;
  createdAt: number;
  counts: Record<string, number>;
  schemaVersion: number;
  appVersion: string;
}

export type PortableMeta = Pick<PortableHeader, 'businessName' | 'createdAt' | 'counts' | 'schemaVersion' | 'appVersion'>;

export class PortableError extends Error {
  constructor(public readonly code: 'not_backup' | 'cloud_file' | 'header' | 'passphrase' | 'weak_passphrase' | 'newer_schema') {
    super(code);
    this.name = 'PortableError';
  }
}

const WRAP_AAD = utf8ToBytes(`${PORTABLE_FORMAT}/1`);
const pow2 = (n: number) => Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;

/** Bounds so a crafted file cannot make the phone run a huge KDF (memory = 128·N·r bytes). */
function validKdf(k: unknown): k is PortableKdf {
  const x = k as PortableKdf;
  return !!x && x.name === 'scrypt' && pow2(x.N) && x.N <= 2 ** 17 && Number.isInteger(x.r) && x.r >= 1 && x.r <= 16 && Number.isInteger(x.p) && x.p >= 1 && x.p <= 4;
}

function b64(s: unknown, len: number): boolean {
  if (typeof s !== 'string') return false;
  try {
    return base64urlDecode(s).length === len;
  } catch {
    return false;
  }
}

export function isPortableHeader(h: unknown): h is PortableHeader {
  const x = h as PortableHeader;
  return (
    !!x &&
    x.format === PORTABLE_FORMAT &&
    x.v === 1 &&
    validKdf(x.kdf) &&
    b64(x.salt, 16) &&
    b64(x.nonce, 12) &&
    b64(x.wrappedKey, 48) &&
    typeof x.businessName === 'string' &&
    Number.isSafeInteger(x.createdAt) &&
    Number.isSafeInteger(x.schemaVersion) &&
    typeof x.appVersion === 'string' &&
    !!x.counts &&
    typeof x.counts === 'object' &&
    Object.values(x.counts).every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/**
 * Read and validate the header from the first bytes of a picked file (no passphrase needed). A cloud ".obk"
 * (server-held key) is recognised and refused with its own code.
 */
export function readPortableHeader(first: Uint8Array): PortableHeader {
  let h: object;
  try {
    h = readObkHeader<object>(first).header;
  } catch (e) {
    throw new PortableError(e instanceof ObkError && e.code === 'magic' ? 'not_backup' : 'header');
  }
  if ((h as { format?: unknown }).format === undefined && 'businessId' in h && 'deviceId' in h) throw new PortableError('cloud_file');
  if (!isPortableHeader(h)) throw new PortableError('header');
  return h;
}

/** A newer app wrote this file (its database is ahead of this app's migrations) → update the app first. */
export function assertPortableSchema(h: PortableHeader, appSchemaVersion: number) {
  if (h.schemaVersion > appSchemaVersion) throw new PortableError('newer_schema');
}

export const portablePassphraseOk = (p: string) => p.normalize('NFC').length >= PORTABLE_PASSPHRASE_MIN;

async function kek(passphrase: string, salt: Uint8Array, kdf: PortableKdf, onProgress?: (p: number) => void): Promise<Uint8Array> {
  return scryptAsync(utf8ToBytes(passphrase.normalize('NFC')), salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: 32, asyncTick: 10, onProgress });
}

export interface PortableOpts {
  kdf?: PortableKdf;
  random?: (n: number) => Uint8Array;
  /** KDF progress 0…1 (it is the slow part on a phone). */
  onProgress?: (p: number) => void;
}

/** New random data key + the header that wraps it with the passphrase. */
export async function sealPortable(passphrase: string, meta: PortableMeta, opts: PortableOpts = {}): Promise<{ header: PortableHeader; dataKey: Uint8Array }> {
  if (!portablePassphraseOk(passphrase)) throw new PortableError('weak_passphrase');
  const random = opts.random ?? randomBytes;
  const kdf = opts.kdf ?? PORTABLE_KDF;
  if (!validKdf(kdf)) throw new PortableError('header');
  const dataKey = random(32);
  const salt = random(16);
  const nonce = random(12);
  const wrapped = gcm(await kek(passphrase, salt, kdf, opts.onProgress), nonce, WRAP_AAD).encrypt(dataKey);
  const header: PortableHeader = {
    format: PORTABLE_FORMAT,
    v: 1,
    kdf: { name: 'scrypt', N: kdf.N, r: kdf.r, p: kdf.p },
    salt: base64urlEncode(salt),
    nonce: base64urlEncode(nonce),
    wrappedKey: base64urlEncode(wrapped),
    businessName: meta.businessName,
    createdAt: meta.createdAt,
    counts: meta.counts,
    schemaVersion: meta.schemaVersion,
    appVersion: meta.appVersion,
  };
  return { header, dataKey };
}

/** Unwrap the data key. Wrong passphrase → PortableError('passphrase'); nothing is decrypted. */
export async function openPortable(header: PortableHeader, passphrase: string, onProgress?: (p: number) => void): Promise<Uint8Array> {
  if (!isPortableHeader(header)) throw new PortableError('header');
  const key = await kek(passphrase, base64urlDecode(header.salt), header.kdf, onProgress);
  try {
    return gcm(key, base64urlDecode(header.nonce), WRAP_AAD).decrypt(base64urlDecode(header.wrappedKey));
  } catch {
    throw new PortableError('passphrase');
  }
}

/** Writer for a portable file (same frame format as .obk; the header is bound into every frame's AAD). */
export function portableWriter(dataKey: Uint8Array, header: PortableHeader, random?: (n: number) => Uint8Array): ObkWriter<PortableHeader> {
  return new ObkWriter<PortableHeader>(dataKey, header, random);
}

/** Reader: header tampering / corruption → ObkError('auth' | 'format' | 'truncated'). */
export function portableReader(dataKey: Uint8Array, ev: ObkEntryEvents): ObkReader<PortableHeader> {
  return new ObkReader<PortableHeader>(dataKey, ev);
}
