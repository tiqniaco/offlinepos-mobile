import { describe, expect, it } from 'vitest';
import { ObkError, ObkWriter } from '../src/backupCodec';
import {
  PORTABLE_KDF,
  PortableError,
  assertPortableSchema,
  openPortable,
  portableReader,
  portableWriter,
  readPortableHeader,
  sealPortable,
  type PortableHeader,
  type PortableMeta,
} from '../src/portableBackup';

const FAST = { name: 'scrypt' as const, N: 2 ** 10, r: 8, p: 1 };
const meta: PortableMeta = { businessName: 'بقالة النور', createdAt: 1_700_000_000_000, counts: { invoices: 3, products: 2 }, schemaVersion: 20, appVersion: '0.1.0' };
const PASS = 'Nour-shop-2026';

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

async function build(payload: Uint8Array, kdf = FAST) {
  const { header, dataKey } = await sealPortable(PASS, meta, { kdf });
  const w = portableWriter(dataKey, header);
  const parts = [w.start(), ...w.beginEntry('db.sqlite', payload.length)];
  for (let o = 0; o < payload.length; o += 5000) parts.push(...w.data(payload.subarray(o, o + 5000)));
  parts.push(...w.finish().frames);
  return { file: concat(parts), header };
}

async function restore(file: Uint8Array, pass = PASS) {
  const h = readPortableHeader(file.subarray(0, 64 * 1024));
  const key = await openPortable(h, pass);
  const got: Uint8Array[] = [];
  const r = portableReader(key, { onEntry: () => undefined, onData: (d) => void got.push(d.slice()) });
  for (let o = 0; o < file.length; o += 3333) r.push(file.subarray(o, o + 3333));
  r.finish();
  return { h, data: concat(got) };
}

const payload = new Uint8Array(70_000).map((_, i) => (i * 31) % 251);

describe('portable .kashiro backup', () => {
  it('round-trips with the passphrase; the header shows only name, date and counts', async () => {
    const { file } = await build(payload);
    const { h, data } = await restore(file);
    expect(data).toEqual(payload);
    expect(h).toMatchObject({ format: 'kashiro-portable', v: 1, businessName: meta.businessName, counts: meta.counts });
    expect(Object.keys(h).sort()).toEqual(['appVersion', 'businessName', 'counts', 'createdAt', 'format', 'kdf', 'nonce', 'salt', 'schemaVersion', 'v', 'wrappedKey']);
  });

  it('files from earlier versions (scrypt N=2^15) still open', async () => {
    const old = { name: 'scrypt' as const, N: 2 ** 15, r: 8, p: 1 };
    const { header } = await sealPortable(PASS, meta, { kdf: old });
    await expect(openPortable(header, PASS)).resolves.toHaveLength(32);
  });

  it('default KDF is scrypt N=2^14 r=8 p=1', async () => {
    expect(PORTABLE_KDF).toEqual({ name: 'scrypt', N: 16384, r: 8, p: 1 });
    const { header } = await sealPortable(PASS, meta);
    expect(header.kdf).toEqual(PORTABLE_KDF);
    await expect(openPortable(header, PASS)).resolves.toHaveLength(32);
  });

  it('wrong passphrase → PortableError(passphrase)', async () => {
    const { file } = await build(payload);
    await expect(restore(file, 'Nour-shop-2025')).rejects.toMatchObject({ code: 'passphrase' });
  });

  it('refuses short passphrases at export', async () => {
    await expect(sealPortable('1234567', meta, { kdf: FAST })).rejects.toBeInstanceOf(PortableError);
  });

  it('corrupted body → AEAD failure', async () => {
    const { file } = await build(payload);
    const bad = file.slice();
    bad[bad.length - 100] ^= 1;
    await expect(restore(bad)).rejects.toBeInstanceOf(ObkError);
  });

  it('header tampering (e.g. counts / business name) → every frame fails (AAD)', async () => {
    const { file, header } = await build(payload);
    const hlen = (file[4]! << 24) | (file[5]! << 16) | (file[6]! << 8) | file[7]!;
    const forged: PortableHeader = { ...header, businessName: 'محل تاني', counts: { invoices: 999 } };
    const hb = new TextEncoder().encode(JSON.stringify(forged));
    const len = new Uint8Array([hb.length >>> 24, (hb.length >>> 16) & 255, (hb.length >>> 8) & 255, hb.length & 255]);
    const tampered = concat([file.subarray(0, 4), len, hb, file.subarray(8 + hlen)]);
    await expect(restore(tampered)).rejects.toMatchObject({ name: 'ObkError', code: 'auth' });
  });

  it('truncated file → error, not a partial restore', async () => {
    const { file } = await build(payload);
    await expect(restore(file.subarray(0, file.length - 40))).rejects.toBeInstanceOf(ObkError);
  });

  it('recognises non-backups, cloud .obk files, and schema newer than the app', async () => {
    expect(() => readPortableHeader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(expect.objectContaining({ code: 'not_backup' }));
    const cloud = new ObkWriter(new Uint8Array(32), { v: 1, businessId: 'b', deviceId: 'd', deviceCode: 'A', schemaVersion: 1, createdAt: 1, counts: {}, appVersion: '1' }).start();
    expect(() => readPortableHeader(cloud)).toThrow(expect.objectContaining({ code: 'cloud_file' }));
    const { header } = await build(payload);
    expect(() => assertPortableSchema(header, 19)).toThrow(expect.objectContaining({ code: 'newer_schema' }));
    expect(() => assertPortableSchema(header, 20)).not.toThrow();
  });

  it('refuses absurd KDF parameters from a crafted header', async () => {
    const { file, header } = await build(payload);
    void file;
    await expect(openPortable({ ...header, kdf: { name: 'scrypt', N: 2 ** 24, r: 8, p: 1 } }, PASS)).rejects.toMatchObject({ code: 'header' });
    await expect(openPortable({ ...header, kdf: { name: 'scrypt', N: 2 ** 16, r: 8, p: 1 } }, PASS)).rejects.toMatchObject({ code: 'header' });
    await expect(openPortable({ ...header, kdf: { name: 'scrypt', N: 2 ** 14, r: 16, p: 1 } }, PASS)).rejects.toMatchObject({ code: 'header' });
  });
});
