/**
 * Encrypted backup container ".obk" (PLAN.md §9.2). Pure and streaming, so the phone can process a large
 * database in small slices (yielding to the UI between slices) and Node tests can check every byte.
 *
 *   file    = "OBK1" | u32 headerLen | header JSON (UTF-8) | frame*
 *   frame   = u32 cipherLen | 12-byte nonce | AES-256-GCM(ciphertext + 16-byte tag)
 *   AAD     = SHA-256(header bytes) | u32 frameIndex | u8 isLast       → reordering / truncation / header swap fail
 *   payload = gzip( entry* ),  entry = u16 nameLen | name | u32 sizeHi | u32 sizeLo | bytes
 * The header (business, device, schema, counts, created) is readable without the key for the restore preview
 * list; the payload SHA-256 is checked after decryption.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { Gunzip, Gzip } from 'fflate';
import { utf8Decode, utf8ToBytes } from './crypto';

export const OBK_MAGIC = [0x4f, 0x42, 0x4b, 0x31]; // "OBK1"
const FRAME_PLAIN = 256 * 1024;

export interface ObkHeader {
  v: 1;
  businessId: string;
  deviceId: string;
  deviceCode: string;
  schemaVersion: number;
  createdAt: number;
  counts: Record<string, number>;
  appVersion: string;
}

export class ObkError extends Error {
  constructor(public readonly code: 'magic' | 'header' | 'auth' | 'truncated' | 'checksum' | 'format') {
    super(code);
    this.name = 'ObkError';
  }
}

const enc = { encode: (s: string) => utf8ToBytes(s) };
const dec = { decode: (b: Uint8Array) => utf8Decode(b) };
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const readU32 = (b: Uint8Array, o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
function aad(headerHash: Uint8Array, index: number, last: boolean) {
  return concat([headerHash, u32(index), new Uint8Array([last ? 1 : 0])]);
}

/** Streaming writer. start() → header bytes; addEntry/push → frames; finish() → final frames + payload hash. */
/** Any JSON header: the cloud/server-key header (ObkHeader) or the passphrase header (PortableHeader). */
export class ObkWriter<H extends object = ObkHeader> {
  private gz: Gzip;
  private pending: Uint8Array[] = [];
  private pendingLen = 0;
  private out: Uint8Array[] = [];
  private index = 0;
  private hash = sha256.create();
  private headerBytes: Uint8Array;
  private headerHash: Uint8Array;

  constructor(private key: Uint8Array, header: H, private random: (n: number) => Uint8Array = randomBytes) {
    if (key.length !== 32) throw new ObkError('format');
    this.headerBytes = enc.encode(JSON.stringify(header));
    this.headerHash = sha256(this.headerBytes);
    this.gz = new Gzip({ level: 6 }, (chunk) => {
      this.pending.push(chunk);
      this.pendingLen += chunk.length;
    });
  }

  start(): Uint8Array {
    return concat([new Uint8Array(OBK_MAGIC), u32(this.headerBytes.length), this.headerBytes]);
  }

  private plain(b: Uint8Array) {
    this.hash.update(b);
    this.gz.push(b);
  }

  /** Begin an entry of `size` bytes; then call data() with its bytes (any chunking). */
  beginEntry(name: string, size: number): Uint8Array[] {
    const nb = enc.encode(name);
    this.plain(concat([new Uint8Array([nb.length >> 8, nb.length & 255]), nb, u32(Math.floor(size / 2 ** 32)), u32(size >>> 0)]));
    return this.drain(false);
  }

  data(chunk: Uint8Array): Uint8Array[] {
    this.plain(chunk);
    return this.drain(false);
  }

  /** Close the stream. Returns the last frames and the SHA-256 of the (uncompressed) payload. */
  finish(): { frames: Uint8Array[]; payloadSha256: string } {
    this.gz.push(new Uint8Array(0), true);
    const frames = this.drain(true);
    return { frames, payloadSha256: bytesToHex(this.hash.digest()) };
  }

  private drain(final: boolean): Uint8Array[] {
    this.out = [];
    while (this.pendingLen >= FRAME_PLAIN || (final && this.pendingLen >= 0 && (this.pendingLen > 0 || this.index === 0 || final))) {
      const all = concat(this.pending);
      const take = final ? Math.min(all.length, FRAME_PLAIN) : FRAME_PLAIN;
      const chunk = all.subarray(0, take);
      const rest = all.subarray(take);
      this.pending = rest.length ? [rest.slice()] : [];
      this.pendingLen = rest.length;
      const last = final && rest.length === 0;
      const nonce = this.random(12);
      const ct = gcm(this.key, nonce, aad(this.headerHash, this.index++, last)).encrypt(chunk);
      this.out.push(concat([u32(ct.length), nonce, ct]));
      if (last) break;
    }
    return this.out;
  }
}

/** Read just the header (no key needed) from the first bytes of a file. */
export function readObkHeader<H extends object = ObkHeader>(first: Uint8Array): { header: H; bodyOffset: number } {
  if (first.length < 8 || OBK_MAGIC.some((m, i) => first[i] !== m)) throw new ObkError('magic');
  const len = readU32(first, 4);
  if (len > 64 * 1024 || first.length < 8 + len) throw new ObkError('header');
  try {
    const header: unknown = JSON.parse(dec.decode(first.subarray(8, 8 + len)));
    if (!header || typeof header !== 'object' || Array.isArray(header)) throw new ObkError('header');
    return { header: header as H, bodyOffset: 8 + len };
  } catch {
    throw new ObkError('header');
  }
}

export interface ObkEntryEvents {
  onEntry: (name: string, size: number) => void;
  onData: (chunk: Uint8Array) => void;
}

/** Streaming reader: push file bytes in any chunking; entries/data are emitted as they decrypt. */
export class ObkReader<H extends object = ObkHeader> {
  private buf: Uint8Array = new Uint8Array(0);
  private headerHash: Uint8Array | null = null;
  header: H | null = null;
  private index = 0;
  private sawLast = false;
  private hash = sha256.create();
  private gunzip: Gunzip;
  private ebuf: Uint8Array = new Uint8Array(0);
  private remaining = 0;

  constructor(private key: Uint8Array, private ev: ObkEntryEvents) {
    this.gunzip = new Gunzip((chunk) => this.payload(chunk));
  }

  push(bytes: Uint8Array) {
    this.buf = this.buf.length ? concat([this.buf, bytes]) : bytes;
    if (!this.header) {
      if (this.buf.length < 8) return;
      const len = readU32(this.buf, 4);
      if (this.buf.length < 8 + len) return;
      const { header, bodyOffset } = readObkHeader<H>(this.buf);
      this.header = header;
      this.headerHash = sha256(this.buf.subarray(8, bodyOffset));
      this.buf = this.buf.subarray(bodyOffset);
    }
    for (;;) {
      if (this.sawLast) {
        if (this.buf.length) throw new ObkError('format');
        return;
      }
      if (this.buf.length < 4) return;
      const clen = readU32(this.buf, 0);
      if (clen > FRAME_PLAIN + 1024) throw new ObkError('format');
      if (this.buf.length < 4 + 12 + clen) return;
      const nonce = this.buf.subarray(4, 16);
      const ct = this.buf.subarray(16, 16 + clen);
      this.buf = this.buf.subarray(16 + clen);
      const last = this.buf.length === 0 && this.tryLast(nonce, ct);
      let plain: Uint8Array;
      if (last) plain = last;
      else {
        try {
          plain = gcm(this.key, nonce, aad(this.headerHash!, this.index, false)).decrypt(ct);
        } catch {
          // Could be the last frame with more bytes after it (format error) or tampering.
          throw new ObkError('auth');
        }
      }
      this.index++;
      if (last) this.sawLast = true;
      this.gunzip.push(plain, !!last);
    }
  }

  private tryLast(nonce: Uint8Array, ct: Uint8Array): Uint8Array | null {
    try {
      return gcm(this.key, nonce, aad(this.headerHash!, this.index, true)).decrypt(ct);
    } catch {
      return null;
    }
  }

  /** Call at the end of the file: checks the stream was complete and the payload hash. */
  finish(expectedSha256?: string): string {
    if (!this.sawLast) throw new ObkError('truncated');
    if (this.remaining !== 0 || this.ebuf.length) throw new ObkError('truncated');
    const h = bytesToHex(this.hash.digest());
    if (expectedSha256 && h !== expectedSha256) throw new ObkError('checksum');
    return h;
  }

  private payload(chunk: Uint8Array) {
    this.hash.update(chunk);
    let c = chunk;
    while (c.length) {
      if (this.remaining > 0) {
        const take = Math.min(this.remaining, c.length);
        this.ev.onData(c.subarray(0, take));
        this.remaining -= take;
        c = c.subarray(take);
        continue;
      }
      this.ebuf = this.ebuf.length ? concat([this.ebuf, c]) : c.slice();
      c = new Uint8Array(0);
      if (this.ebuf.length < 2) return;
      const nl = (this.ebuf[0]! << 8) | this.ebuf[1]!;
      if (this.ebuf.length < 2 + nl + 8) return;
      const name = dec.decode(this.ebuf.subarray(2, 2 + nl));
      const size = readU32(this.ebuf, 2 + nl) * 2 ** 32 + readU32(this.ebuf, 6 + nl);
      const rest = this.ebuf.subarray(10 + nl);
      this.ebuf = new Uint8Array(0);
      this.remaining = size;
      this.ev.onEntry(name, size);
      if (size === 0) this.ev.onData(new Uint8Array(0));
      c = rest;
    }
  }
}
