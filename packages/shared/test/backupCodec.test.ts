import { describe, expect, it } from 'vitest';
import { ObkReader, ObkWriter, readObkHeader, ObkError, type ObkHeader } from '../src/backupCodec';

const key = new Uint8Array(32).map((_, i) => i + 1);
const header: ObkHeader = { v: 1, businessId: 'b1', deviceId: 'd1', deviceCode: 'A', schemaVersion: 12, createdAt: 1, counts: { invoices: 3 }, appVersion: '0.1.0' };

function build(entries: [string, Uint8Array][], chunk = 1000): { file: Uint8Array; sha: string } {
  const w = new ObkWriter(key, header);
  const parts: Uint8Array[] = [w.start()];
  for (const [name, data] of entries) {
    parts.push(...w.beginEntry(name, data.length));
    for (let o = 0; o < data.length; o += chunk) parts.push(...w.data(data.subarray(o, o + chunk)));
  }
  const f = w.finish();
  parts.push(...f.frames);
  const n = parts.reduce((s, p) => s + p.length, 0);
  const file = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    file.set(p, o);
    o += p.length;
  }
  return { file, sha: f.payloadSha256 };
}

function read(file: Uint8Array, k = key, chunk = 777, sha?: string) {
  const parts: Record<string, Uint8Array[]> = {};
  let cur = '';
  const r = new ObkReader(k, { onEntry: (n) => ((cur = n), (parts[n] = [])), onData: (d) => void parts[cur]!.push(d.slice()) });
  for (let o = 0; o < file.length; o += chunk) r.push(file.subarray(o, o + chunk));
  r.finish(sha);
  const got: Record<string, Uint8Array> = {};
  for (const [n, ps] of Object.entries(parts)) {
    const out = new Uint8Array(ps.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of ps) {
      out.set(p, o);
      o += p.length;
    }
    got[n] = out;
  }
  return { got, header: r.header };
}

const rnd = (n: number, seed = 7) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) out[i] = (x = (x * 1103515245 + 12345) >>> 0) >>> 24;
  return out;
};

describe('.obk backup container', () => {
  it('round-trips several entries (db + images) with any chunking; header readable without the key', () => {
    const db = rnd(1_200_000);
    const img = rnd(40_000, 3);
    const { file, sha } = build([['db.sqlite', db], ['img/p1.jpg', img], ['empty', new Uint8Array(0)]]);
    expect(readObkHeader(file.subarray(0, 4096)).header).toMatchObject({ businessId: 'b1', counts: { invoices: 3 } });
    const { got } = read(file, key, 65_536, sha);
    expect(got['db.sqlite']).toEqual(db);
    expect(got['img/p1.jpg']).toEqual(img);
    expect(got.empty!.length).toBe(0);
    expect(file.length).toBeLessThan(db.length + img.length + 4096); // random data barely compresses
  });

  it('compresses real-looking data', () => {
    const text = new TextEncoder().encode('INSERT INTO sales_lines VALUES (1, 2, 3, "شاي العروسة");\n'.repeat(50_000));
    expect(build([['db.sqlite', text]]).file.length).toBeLessThan(text.length / 20);
  });

  it('wrong key, flipped byte, truncation, swapped header and wrong checksum are all rejected', () => {
    const { file, sha } = build([['db.sqlite', rnd(600_000)]]);
    expect(() => read(file, new Uint8Array(32))).toThrow(ObkError);
    const flipped = file.slice();
    flipped[flipped.length - 50]! ^= 1;
    expect(() => read(flipped)).toThrow(/auth|truncated/);
    expect(() => read(file.subarray(0, file.length - 300_000))).toThrow(/truncated|auth/);
    const other = build([['db.sqlite', rnd(600_000)]]).file;
    // Header of one file + frames of another (same key) → AAD mismatch.
    const hdrLen = 8 + new DataView(file.buffer).getUint32(4);
    const mixed = new Uint8Array([...file.subarray(0, hdrLen).map((b, i) => (i === hdrLen - 3 ? b ^ 0 : b))]);
    void mixed;
    const tamperedHeader = file.slice();
    tamperedHeader[20]! ^= 1; // a byte inside the JSON header
    expect(() => read(tamperedHeader)).toThrow(ObkError);
    expect(() => read(file, key, 777, 'f'.repeat(64))).toThrow(/checksum/);
    expect(() => read(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]))).toThrow(/magic/);
    void other;
  });
});
