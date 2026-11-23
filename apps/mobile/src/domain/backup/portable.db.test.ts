import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_PLANS,
  ObkError,
  PORTABLE_BACKUP_KEY_ENTRY,
  PortableError,
  assertPortableSchema,
  openPortable,
  portableReader,
  portableWriter,
  readPortableHeader,
  sealPortable,
  type LicenceState,
  type PortableHeader,
} from '@daftarak/shared';
import * as schema from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { evaluateLicence, setLicenceState } from '../licence/guard';
import { insertUser, seedSystemRoles, unlockWithPin } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { cartLineFor, postSale, type SalesCtx } from '../sales/sales';
import { saveParty } from '../parties/parties';
import { verifyChain } from '../integrity/chain';
import { getCurrentDevice, getMeta, setMeta } from '../device';
import { backupCounts, dumpTables } from './restore';
import { finishPortableRestore, hasDocuments, isUnlinked, linkRestoredDevice, portableMeta, portableReminder, currentLicenceRow } from './portable';

const journal = JSON.parse(fs.readFileSync(path.join(__dirname, '../../db/migrations/meta/_journal.json'), 'utf8')) as { entries: unknown[] };
const APP_SCHEMA = journal.entries.length;
const FAST = { name: 'scrypt' as const, N: 2 ** 12, r: 8, p: 1 };
const PASS = 'Shop2026ok';
const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const lic: LicenceState = { mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kashiro-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function openFile(file: string): { db: Db; raw: Database.Database } {
  const raw = new Database(file);
  raw.pragma('foreign_keys = ON');
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '../../db/migrations') });
  return { db: db as unknown as Db, raw };
}

const concat = (parts: Uint8Array[]) => Buffer.concat(parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.length)));

/** Old phone: a shop with an owner (account password), a cashier (PIN), products, customers, invoices. */
async function oldPhone(name: string) {
  setLicenceState(lic);
  let clock = Date.UTC(2026, 10, 20, 8);
  const A = { id: 'dev-A', code: 'A' };
  const { db, raw } = openFile(path.join(tmp, `${name}.db`));
  await ensureInventorySeed(db, A, clock);
  await setMeta(db, 'device_id', A.id);
  await setMeta(db, 'device_code', A.code);
  await db.insert(schema.devices).values({ id: A.id, code: 'A', platform: 'android', isCurrent: true, activatedAt: clock, createdAt: clock, updatedAt: clock });
  await db.insert(schema.business).values({ id: 'b-local', serverBusinessId: 'biz-1', name: 'بقالة النور', country: 'EG', type: 'shop', currency: 'EGP', vatRegistered: false, vatNumber: null, timezone: 'Africa/Cairo', phonesJson: '[]', createdAt: clock, updatedAt: clock, deviceId: A.id });
  await db.insert(schema.licenceState).values({ id: 1, token: 'lic1.old-phone-token.sig', lastCheckinAt: clock, lastServerTime: clock, maxSeenTime: clock, updatedAt: clock });
  const ids = await withTx(db, async (tx) => {
    const roles = await seedSystemRoles(tx, { deviceId: A.id, deviceCode: 'A', now: clock });
    const owner = await insertUser(tx, { name: 'أحمد', password: PASS, roleId: roles.owner, createdBy: null, deviceId: A.id, deviceCode: 'A', now: clock, colorIndex: 0 });
    const cashier = await insertUser(tx, { name: 'كريم', pin: '2580', roleId: roles.cashier, createdBy: owner, deviceId: A.id, deviceCode: 'A', now: clock + 1, colorIndex: 1 });
    return { owner, cashier };
  });
  const user = await unlockWithPin(db, ids.owner, PASS);
  const ctx = { db, user, device: A, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 }, vatRegistered: false, vatRateBp: 0 } satisfies SalesCtx & Record<string, unknown>;
  const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  const tea = await createProduct(ctx, { name: 'شاي العروسة', baseUnitId: piece, costMinor: 1000, retailPriceMinor: 2000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['622'], openingQtyMilli: 50_000 });
  const c = await saveParty(ctx, 'C', { name: 'محمود الجزار', mobile: '01001234567' });
  for (let i = 0; i < 12; i++) await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, tea, null, 'retail', 1000)], priceTier: 'retail', customerId: i % 2 ? c : null, customerName: null }, [{ method: i % 2 ? 'credit' : 'cash', amountMinor: 2000 }]);
  return { db, raw, ids, ctx, tea, clock };
}

/** Export exactly as the phone does: header (no customer data) + db snapshot + business backup key. */
async function exportPortable(db: Db, raw: Database.Database, pass = PASS, schemaVersion = APP_SCHEMA) {
  const snap = path.join(tmp, `snap-${Math.random().toString(36).slice(2)}.sqlite`);
  raw.exec(`VACUUM INTO '${snap}'`);
  const meta = await portableMeta(db);
  const { header, dataKey } = await sealPortable(pass, { ...meta, createdAt: Date.UTC(2026, 10, 22), schemaVersion, appVersion: '0.1.0' }, { kdf: FAST });
  const w = portableWriter(dataKey, header);
  const bytes = fs.readFileSync(snap);
  const out: Uint8Array[] = [w.start(), ...w.beginEntry('db.sqlite', bytes.length)];
  for (let o = 0; o < bytes.length; o += 64 * 1024) out.push(...w.data(bytes.subarray(o, o + 64 * 1024)));
  const backupKey = new Uint8Array(32).fill(7);
  out.push(...w.beginEntry(PORTABLE_BACKUP_KEY_ENTRY, 32), ...w.data(backupKey));
  out.push(...w.finish().frames);
  fs.rmSync(snap);
  return { file: concat(out), header };
}

/** New phone, no server: header check → passphrase → decrypt every frame → plain snapshot file + secrets. */
async function importPortable(file: Buffer, pass: string, target: string) {
  const header = readPortableHeader(file.subarray(0, 64 * 1024 + 8));
  assertPortableSchema(header, APP_SCHEMA);
  const key = await openPortable(header, pass);
  const fd = fs.openSync(target, 'w');
  const secrets: Record<string, number[]> = {};
  let cur = '';
  try {
    const r = portableReader(key, { onEntry: (n) => (cur = n), onData: (d) => (cur === 'db.sqlite' ? fs.writeSync(fd, d) : (secrets[cur] = [...(secrets[cur] ?? []), ...d])) });
    for (let o = 0; o < file.length; o += 100_000) r.push(file.subarray(o, o + 100_000));
    r.finish();
  } finally {
    fs.closeSync(fd);
  }
  return { header, secrets };
}

const TABLES_EXCLUDED = ['devices', 'kv_meta', 'doc_sequences', 'audit_log', 'licence_state'];

describe('portable .kashiro backup → restore on a new phone without the server', () => {
  it('round-trip: identical data, unlock with restored password/PIN, read-only until linked, then linked', async () => {
    const { db, raw, ids, ctx, tea } = await oldPhone('old1');
    const { file, header } = await exportPortable(db, raw);

    // Readable header = business name, date, counts only; nothing of the customers/products in clear.
    expect(header.businessName).toBe('بقالة النور');
    expect(header.counts).toEqual({ invoices: 12, products: 1, customers: 1, suppliers: 0 });
    expect(file.includes(Buffer.from('محمود الجزار'))).toBe(false);
    expect(file.includes(Buffer.from('01001234567'))).toBe(false);
    expect(file.includes(Buffer.from('شاي العروسة'))).toBe(false);

    const target = path.join(tmp, 'new1.db');
    const { secrets } = await importPortable(file, PASS, target);
    expect(secrets[PORTABLE_BACKUP_KEY_ENTRY]).toEqual(new Array(32).fill(7));
    const n = openFile(target);
    const dev = await finishPortableRestore(n.db, { kind: 'offline' }, { platform: 'android', now: Date.UTC(2026, 10, 23), random: () => new Uint8Array([0, 1, 2, 3]) });
    expect(dev.deviceCode).toMatch(/^L[A-Z2-9]{4}$/);

    const tables = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '__drizzle%'`).all() as { name: string }[]).map((t) => t.name).filter((t) => !TABLES_EXCLUDED.includes(t) && t !== 'users');
    expect(await dumpTables(n.db, tables)).toEqual(await dumpTables(db, tables));
    expect(await backupCounts(n.db)).toEqual(await backupCounts(db));
    expect((await verifyChain(n.db, 'dev-A')).ok).toBe(true);

    // Owner password and staff PIN restored with the data still unlock this phone, offline.
    expect((await unlockWithPin(n.db, ids.owner, PASS)).id).toBe(ids.owner);
    expect((await unlockWithPin(n.db, ids.cashier, '2580')).id).toBe(ids.cashier);
    await expect(unlockWithPin(n.db, ids.cashier, '1111')).rejects.toMatchObject({ code: 'wrong' });

    // The old phone's licence is bound to the old phone: dropped → read-only (view / print / export) until linked.
    expect(await isUnlinked(n.db)).toBe(true);
    expect((await currentLicenceRow(n.db))!.token).toBeNull();
    expect((await currentLicenceRow(n.db))!.maxSeenTime).toBeGreaterThan(0); // clock-rollback guard kept
    const cur = (await getCurrentDevice(n.db))!;
    expect(cur).toEqual({ id: dev.deviceId, code: dev.deviceCode });
    const state = evaluateLicence((await currentLicenceRow(n.db))!.token, { now: Date.UTC(2026, 10, 23), deviceId: cur.id, maxSeenTime: 0 });
    expect(state).toMatchObject({ mode: 'read_only', canWrite: false, reason: 'no_licence' });

    // Later, online: the server registers this phone (code C) → it continues with its own numbering and chain.
    await linkRestoredDevice(n.db, { deviceId: 'dev-C', deviceCode: 'C' }, { platform: 'android', now: Date.UTC(2026, 10, 24) });
    expect(await isUnlinked(n.db)).toBe(false);
    setLicenceState(lic);
    const ctxC = { ...ctx, db: n.db, device: { id: 'dev-C', code: 'C' }, user: await unlockWithPin(n.db, ids.owner, PASS) };
    const sale = await postSale(ctxC, { lines: [await cartLineFor(n.db, ctx.settings, tea, null, 'retail', 1000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 2000 }]);
    expect(sale.number).toBe('INV-C-000001');
    expect((await verifyChain(n.db, 'dev-C')).ok).toBe(true);
    const devs = await n.db.select().from(schema.devices);
    expect(devs.filter((d) => d.isCurrent).map((d) => d.id)).toEqual(['dev-C']);
    expect(devs.find((d) => d.id === dev.deviceId)).toMatchObject({ isCurrent: false });
    n.raw.close();
  }, 60_000);

  it('wrong passphrase → clear error, nothing written', async () => {
    const { db, raw } = await oldPhone('old2');
    const { file } = await exportPortable(db, raw);
    const target = path.join(tmp, 'new2.db');
    await expect(importPortable(file, 'Shop2026OK', target)).rejects.toSatisfy((e) => e instanceof PortableError && e.code === 'passphrase');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('corrupted file → AEAD failure (no partial restore)', async () => {
    const { db, raw } = await oldPhone('old3');
    const { file } = await exportPortable(db, raw);
    const bad = Buffer.from(file);
    bad[Math.floor(bad.length / 2)]! ^= 0x40;
    await expect(importPortable(bad, PASS, path.join(tmp, 'new3.db'))).rejects.toBeInstanceOf(ObkError);
    await expect(importPortable(file.subarray(0, file.length - 10), PASS, path.join(tmp, 'new3b.db'))).rejects.toBeInstanceOf(ObkError);
  });

  it('header tampering (name / counts / schema) → every frame fails even with the right passphrase', async () => {
    const { db, raw } = await oldPhone('old4');
    const { file, header } = await exportPortable(db, raw);
    const len = file.readUInt32BE(4);
    const forged: PortableHeader = { ...header, businessName: 'محل تاني', counts: { ...header.counts, invoices: 0 } };
    const hb = Buffer.from(JSON.stringify(forged));
    const lenB = Buffer.alloc(4);
    lenB.writeUInt32BE(hb.length);
    const tampered = Buffer.concat([file.subarray(0, 4), lenB, hb, file.subarray(8 + len)]);
    await expect(importPortable(tampered, PASS, path.join(tmp, 'new4.db'))).rejects.toMatchObject({ name: 'ObkError', code: 'auth' });
  });

  it('a file from a newer app (schema ahead of this app) is refused before anything is decrypted', async () => {
    const { db, raw } = await oldPhone('old5');
    const { file } = await exportPortable(db, raw, PASS, APP_SCHEMA + 1);
    await expect(importPortable(file, PASS, path.join(tmp, 'new5.db'))).rejects.toSatisfy((e) => e instanceof PortableError && e.code === 'newer_schema');
  });

  it('existing empty shop of the same business keeps its own device, licence and sign-in', async () => {
    const { db, raw, ids } = await oldPhone('old6');
    const { file } = await exportPortable(db, raw);
    // This phone: registered for biz-1 as device B with its own licence, no documents yet.
    const { db: here } = openFile(path.join(tmp, 'here6.db'));
    await ensureInventorySeed(here, { id: 'dev-B', code: 'B' }, 1);
    await here.insert(schema.licenceState).values({ id: 1, token: 'lic1.phone-B.sig', lastCheckinAt: 5, lastServerTime: 5, maxSeenTime: 5, updatedAt: 5 });
    expect(await hasDocuments(here)).toBe(false);
    expect(await hasDocuments(db)).toBe(true);
    const keep = await currentLicenceRow(here);

    const target = path.join(tmp, 'new6.db');
    await importPortable(file, PASS, target);
    const n = openFile(target);
    await finishPortableRestore(n.db, { kind: 'keep', device: { id: 'dev-B', code: 'B' }, licence: keep }, { platform: 'ios', now: Date.UTC(2026, 10, 23) });
    expect(await getCurrentDevice(n.db)).toEqual({ id: 'dev-B', code: 'B' });
    expect((await currentLicenceRow(n.db))!.token).toBe('lic1.phone-B.sig');
    expect(await isUnlinked(n.db)).toBe(false);
    expect((await unlockWithPin(n.db, ids.owner, PASS)).id).toBe(ids.owner);
    expect((await n.db.select().from(schema.devices).where(eq(schema.devices.id, 'dev-A')))[0]).toMatchObject({ isCurrent: false });
    expect(await getMeta(n.db, 'device_code')).toBe('B');
  });

  it('weekly reminder: due after 7 days or when never made', () => {
    const now = Date.UTC(2026, 10, 23);
    expect(portableReminder(null, now)).toEqual({ days: null, due: true });
    expect(portableReminder(now - 3 * 86_400_000, now)).toEqual({ days: 3, due: false });
    expect(portableReminder(now - 8 * 86_400_000, now)).toEqual({ days: 8, due: true });
  });
});
