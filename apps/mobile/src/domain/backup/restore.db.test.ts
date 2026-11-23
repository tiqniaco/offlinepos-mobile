import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DEFAULT_PLANS, SYSTEM_ROLES, ObkReader, ObkWriter, readObkHeader, type LicenceState } from '@daftarak/shared';
import * as schema from '../../db/schema';
import type { Db } from '../../db/types';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { cartLineFor, postSale, type SalesCtx } from '../sales/sales';
import { saveParty } from '../parties/parties';
import { postPurchase, purchaseLineFor } from '../purchases/purchases';
import { postVoucher } from '../vouchers/vouchers';
import { verifyChain } from '../integrity/chain';
import { trialBalance } from '../accounting/journal';
import { setMeta } from '../device';
import { backupCounts, completeRestore, dumpTables } from './restore';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const lic: LicenceState = { mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
const owner = SYSTEM_ROLES[0]!;
const user: SessionUser = { id: 'u1', name: 'o', color: '#000', roleId: 'r', roleKey: owner.key, roleName: owner.nameAr, permissions: owner.permissions, maxItemDiscountBp: 10_000, maxInvoiceDiscountBp: 10_000, biometricEnabled: false };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'obk-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function openFile(file: string): { db: Db; raw: Database.Database } {
  const raw = new Database(file);
  raw.pragma('foreign_keys = ON');
  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '../../db/migrations') });
  return { db: db as unknown as Db, raw };
}

describe('backup → restore on a new phone', () => {
  it('reproduces identical data, a verifiable chain, and the new device continues with its own numbering', async () => {
    setLicenceState(lic);
    let clock = Date.UTC(2026, 10, 22, 8);
    const A = { id: 'dev-A', code: 'A' };
    const { db, raw } = openFile(path.join(tmp, 'old.db'));
    await ensureInventorySeed(db, A, clock);
    await setMeta(db, 'device_id', A.id);
    await db.insert(schema.devices).values({ id: A.id, code: 'A', platform: 'android', isCurrent: true, activatedAt: clock, createdAt: clock, updatedAt: clock });
    const ctx = { db, user, device: A, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 }, vatRegistered: false, vatRateBp: 0 } satisfies SalesCtx & Record<string, unknown>;
    const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
    const tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1000, retailPriceMinor: 2000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['1'], openingQtyMilli: 50_000 });
    const c = await saveParty(ctx, 'C', { name: 'محمود' });
    const s = await saveParty(ctx, 'S', { name: 'مورد' });
    for (let i = 0; i < 25; i++) await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, tea, null, 'retail', 1000 + i * 1000)], priceTier: 'retail', customerId: i % 2 ? c : null, customerName: null }, [{ method: i % 2 ? 'credit' : 'cash', amountMinor: 2000 + i * 2000 }]);
    await postPurchase(ctx, { supplierId: s, lines: [await purchaseLineFor(db, ctx, tea, null, 10_000)], pricesIncludeVat: true }, [{ method: 'credit', amountMinor: 10_000 }]);
    await postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 5000, method: 'cash' });
    const counts = await backupCounts(db);
    expect(counts).toMatchObject({ invoices: 25, products: 1, customers: 1, suppliers: 1 });

    // 1. consistent snapshot (on the phone: ATTACH … KEY '' + sqlcipher_export) — here VACUUM INTO.
    const snap = path.join(tmp, 'snap.sqlite');
    raw.exec(`VACUUM INTO '${snap}'`);
    // 2. encrypt in small slices (the phone yields to the UI between slices)
    const key = new Uint8Array(32).map((_, i) => 200 - i);
    const w = new ObkWriter(key, { v: 1, businessId: 'biz', deviceId: A.id, deviceCode: 'A', schemaVersion: 12, createdAt: clock, counts: counts as unknown as Record<string, number>, appVersion: '0.1.0' });
    const out: Uint8Array[] = [w.start()];
    const bytes = fs.readFileSync(snap);
    out.push(...w.beginEntry('db.sqlite', bytes.length));
    for (let o = 0; o < bytes.length; o += 64 * 1024) out.push(...w.data(bytes.subarray(o, o + 64 * 1024)));
    out.push(...w.beginEntry('img/p1.jpg', 3), ...w.data(new Uint8Array([1, 2, 3])));
    const fin = w.finish();
    out.push(...fin.frames);
    const obk = Buffer.concat(out);
    expect(obk.includes(Buffer.from('شاي'))).toBe(false); // nothing readable in the file
    expect(readObkHeader(obk.subarray(0, 4096)).header.counts.invoices).toBe(25);

    // 3. new phone: decrypt → install → completeRestore with device B
    const restored = path.join(tmp, 'new.db');
    const fd = fs.openSync(restored, 'w');
    const images: Record<string, number> = {};
    let cur = '';
    const r = new ObkReader(key, { onEntry: (n) => (cur = n), onData: (d) => (cur === 'db.sqlite' ? fs.writeSync(fd, d) : (images[cur] = (images[cur] ?? 0) + d.length)) });
    for (let o = 0; o < obk.length; o += 100_000) r.push(obk.subarray(o, o + 100_000));
    r.finish(fin.payloadSha256);
    fs.closeSync(fd);
    expect(images['img/p1.jpg']).toBe(3);
    const n = openFile(restored);
    const B = { deviceId: 'dev-B', deviceCode: 'B' };
    await completeRestore(n.db, B, { platform: 'ios', backupId: 'bk1', now: clock + 10_000 });

    // Identical business data (device-local / restore bookkeeping tables excluded).
    const tables = (raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '__drizzle%'`).all() as { name: string }[])
      .map((t) => t.name)
      .filter((t) => !['devices', 'kv_meta', 'doc_sequences', 'audit_log', 'expense_categories'].includes(t));
    expect(await dumpTables(n.db, tables)).toEqual(await dumpTables(db, tables));
    // A backup without expense types gets the defaults (no empty list on the new phone).
    expect((await dumpTables(n.db, ['expense_categories'])).expense_categories!.length).toBeGreaterThan(0);
    expect((await verifyChain(n.db, A.id)).ok).toBe(true);
    expect(await backupCounts(n.db)).toEqual(counts);

    // 4. the new phone keeps working: own numbering + own chain from genesis, books still balance.
    const ctxB = { ...ctx, db: n.db, device: { id: B.deviceId, code: 'B' } };
    const sale = await postSale(ctxB, { lines: [await cartLineFor(n.db, ctx.settings, tea, null, 'retail', 1000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 2000 }]);
    expect(sale.number).toBe('INV-B-000001');
    expect((await verifyChain(n.db, B.deviceId)).ok).toBe(true);
    expect([...(await trialBalance(n.db)).values()].reduce((a, b) => a + b, 0)).toBe(0);
    const devs = await n.db.select().from(schema.devices);
    expect(devs.find((d) => d.id === A.id)).toMatchObject({ isCurrent: false });
    expect(devs.find((d) => d.id === B.deviceId)).toMatchObject({ isCurrent: true, code: 'B' });
  }, 60_000);
});
