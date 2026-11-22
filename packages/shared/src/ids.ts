/**
 * UUIDv7 ids (generated on device) and a Hybrid Logical Clock.
 * Requires `globalThis.crypto.getRandomValues` (polyfilled on React Native with expo-crypto).
 */

interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  (globalThis as unknown as { crypto: CryptoLike }).crypto.getRandomValues(b);
  return b;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = -1;
let lastSeq = 0;

/**
 * RFC 9562 UUIDv7: 48-bit unix ms timestamp + version + 12-bit monotonic counter + random.
 * Monotonic within one process even when called many times in the same millisecond.
 */
export function uuidv7(nowMs: number = Date.now()): string {
  let ms = nowMs;
  if (ms <= lastMs) {
    ms = lastMs;
    lastSeq++;
    if (lastSeq > 0xfff) {
      ms = lastMs + 1;
      lastSeq = 0;
    }
  } else {
    lastSeq = 0;
  }
  lastMs = ms;
  const b = randomBytes(16);
  // 48-bit timestamp, big endian
  let t = ms;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = 0x70 | ((lastSeq >> 8) & 0x0f);
  b[7] = lastSeq & 0xff;
  b[8] = 0x80 | (b[8]! & 0x3f); // variant 10
  const h = Array.from(b, (x) => HEX[x]).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s);
}

/** Timestamp (ms) encoded in a UUIDv7. */
export function uuidv7Time(id: string): number {
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

/**
 * Hybrid Logical Clock — used for future multi-device field-level last-write-wins (SPEC §8).
 * Format: "<13-digit ms>-<4-hex counter>-<device code>" which sorts lexicographically.
 */
export class HybridLogicalClock {
  private ms = 0;
  private counter = 0;
  constructor(
    private readonly deviceCode: string,
    private readonly now: () => number = Date.now,
  ) {}

  tick(): string {
    const wall = this.now();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return this.format();
  }

  /** Merge a remote HLC (when sync arrives later). */
  receive(remote: string): string {
    const r = parseHlc(remote);
    const wall = this.now();
    const maxMs = Math.max(wall, this.ms, r.ms);
    if (maxMs === this.ms && maxMs === r.ms) this.counter = Math.max(this.counter, r.counter) + 1;
    else if (maxMs === this.ms) this.counter++;
    else if (maxMs === r.ms) this.counter = r.counter + 1;
    else this.counter = 0;
    this.ms = maxMs;
    return this.format();
  }

  private format(): string {
    return `${String(this.ms).padStart(13, '0')}-${this.counter.toString(16).padStart(4, '0')}-${this.deviceCode}`;
  }
}

export function parseHlc(s: string): { ms: number; counter: number; device: string } {
  const m = /^(\d{13})-([0-9a-f]{4,})-(.+)$/.exec(s);
  if (!m) throw new Error(`invalid HLC: ${s}`);
  return { ms: Number(m[1]), counter: parseInt(m[2]!, 16), device: m[3]! };
}
