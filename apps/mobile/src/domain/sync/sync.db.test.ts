import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { businessDay, catalogAad, DEFAULT_PLANS, newSyncKey, openSync, opAad, sealSync, SYSTEM_ROLES, uuidv7, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { business, salesDocs, stockLevels, syncApplied, syncOutbox, users } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import { seedSystemRoles, insertUser, toSessionUser, unlockWithPin } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { cartLineFor, postSale, type SalesCtx } from '../sales/sales';
import { buildCatalog, catalogKey, pendingStock, installCatalog, type Catalog } from './catalog';
import { writeCashierLocal } from './local';
import { applyOp } from './apply';
import { setPhoneRole } from './role';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const lic: LicenceState = { mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
const TZ = 'Africa/Cairo';
const MAIN = { id: 'dev-main', code: 'A' };
const CASH = { id: 'dev-cash', code: 'B' };
const BIZ = 'biz-1';
const settings = { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 };

let main: Db;
let clock: number;
let tea: string;
let cashierId: string;

beforeEach(async () => {
  setLicenceState(lic);
  setPhoneRole('main');
  clock = Date.UTC(2026, 10, 24, 8, 0, 0);
  main = createTestDb();
  await main.insert(business).values({ id: 'b', serverBusinessId: BIZ, name: 'بقالة النور', country: 'EG', type: 'shop', currency: 'EGP', vatRegistered: false, timezone: TZ, createdAt: clock, updatedAt: clock, deviceId: MAIN.id });
  await ensureInventorySeed(main, MAIN, clock);
  const roleIds = await seedSystemRoles(main, { deviceId: MAIN.id, deviceCode: MAIN.code, now: clock });
  await insertUser(main, { name: 'أحمد', password: 'Test2026ok', roleId: roleIds.owner, createdBy: null, deviceId: MAIN.id, deviceCode: MAIN.code, now: clock, colorIndex: 0 });
  cashierId = await insertUser(main, { name: 'سارة', pin: '258147', roleId: roleIds.cashier, createdBy: null, deviceId: MAIN.id, deviceCode: MAIN.code, now: clock, colorIndex: 1 });
  const owner = (await main.select().from(users).where(eq(users.name, 'أحمد')))[0]!;
  const ctx = { db: main, user: await toSessionUser(main, owner.id), device: MAIN, timezone: TZ, negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings } as SalesCtx;
  const piece = (await listUnits(main)).find((u) => u.nameAr === 'قطعة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1000, retailPriceMinor: 2000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['622100'], openingQtyMilli: 10_000 });
});
afterEach(() => setPhoneRole('main'));

const qtyOf = async (db: Db, p: string) => (await db.select().from(stockLevels).where(eq(stockLevels.productId, p)))[0]?.qtyMilli;

describe('cashier phone ⇄ main phone', () => {
  it('join from the sealed catalog, sell offline on the cashier phone, the main phone posts the same invoice once', async () => {
    const key = newSyncKey();
    const cat = await buildCatalog(main, clock);
    // Through the server: sealed, opaque.
    const sealed = sealSync(key, cat, catalogAad(BIZ));
    expect(() => openSync(newSyncKey(), sealed, catalogAad(BIZ))).toThrow();
    expect(() => openSync(key, sealed, catalogAad('other'))).toThrow();
    const opened = openSync<Catalog>(key, sealed, catalogAad(BIZ));

    const cash = createTestDb();
    await writeCashierLocal(cash, { business: { id: BIZ, name: 'بقالة النور', country: 'EG', type: 'shop' }, deviceId: CASH.id, deviceCode: CASH.code }, key, opened, 'android', clock);
    expect(await qtyOf(cash, tea)).toBe(10_000);
    // The cashier signs in with her own PIN; on a cashier phone she only sells.
    const sara = await unlockWithPin(cash, cashierId, '258147');
    expect(sara.permissions).toEqual(['sales.create']);

    const cctx = { db: cash, user: sara, device: CASH, timezone: TZ, negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings } as SalesCtx;
    const sale = await postSale(cctx, { lines: [await cartLineFor(cash, settings, tea, null, 'retail', 3000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 6000 }]);
    expect(sale.number).toBe('INV-B-000001');
    const out = await cash.select().from(syncOutbox);
    expect(out).toHaveLength(1);
    expect(await pendingStock(cash)).toEqual(new Map([[tea, 3000]]));
    expect(await qtyOf(cash, tea)).toBe(7000);

    // A newer catalog arrives before the main phone got the sale: the sale is still counted on the cashier phone.
    await installCatalog(cash, await buildCatalog(main, clock), CASH.id);
    expect(await qtyOf(cash, tea)).toBe(7000);

    // Main phone: receives the op (sealed per phone + seq), posts it with the cashier phone's number.
    setPhoneRole('main');
    const blob = sealSync(key, JSON.parse(out[0]!.payload), opAad(BIZ, CASH.id, out[0]!.seq));
    const payload = openSync(key, blob, opAad(BIZ, CASH.id, out[0]!.seq));
    const op = { deviceId: CASH.id, deviceCode: CASH.code, seq: out[0]!.seq, kind: 'sale', payload };
    expect(await applyOp(main, op, { timezone: TZ, features: pro.features })).toBe('applied');
    expect(await applyOp(main, op, { timezone: TZ, features: pro.features })).toBe('duplicate');
    const docs = await main.select().from(salesDocs).where(eq(salesDocs.id, sale.docId));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ number: 'INV-B-000001', totalMinor: 6000, cashierId, status: 'POSTED', deviceId: CASH.id });
    expect(await qtyOf(main, tea)).toBe(7000);
    // Reports on the main phone see it as a normal sale of today.
    expect(docs[0]!.businessDay).toBe(businessDay(out[0]!.createdAt, TZ));

    // Applied → the cashier phone no longer subtracts it; the fresh catalog already has it.
    setPhoneRole('cashier');
    await cash.update(syncOutbox).set({ appliedAt: clock });
    await installCatalog(cash, await buildCatalog(main, clock), CASH.id);
    expect(await qtyOf(cash, tea)).toBe(7000);
  });

  it('a sale the main phone cannot post is kept with the reason (never blocks the others)', async () => {
    const op = { deviceId: CASH.id, deviceCode: CASH.code, seq: 9, kind: 'sale', payload: { docId: uuidv7(clock), number: 'INV-B-000009', at: clock, userId: 'nobody', approvedById: null, draft: { lines: [], priceTier: 'retail' }, pays: [], settings } };
    expect(await applyOp(main, op, { timezone: TZ, features: pro.features })).toBe('failed');
    expect((await main.select().from(syncApplied))[0]).toMatchObject({ key: `${CASH.id}:9`, error: 'unknown_user' });
    // Not "applied": the next catalog tells the cashier phone to keep counting it, and it is retried.
    expect((await buildCatalog(main, clock)).applied[CASH.id]).toEqual({ upTo: 0, failed: [9] });
    expect(await applyOp(main, op, { timezone: TZ, features: pro.features })).toBe('failed');
  });

  it("the owner's password hash never goes to a cashier phone; PIN lockout stays per phone", async () => {
    const cat = await buildCatalog(main, clock);
    expect(cat.tables.users.map((u) => u.name)).toEqual(['سارة']);
    const cash = createTestDb();
    await writeCashierLocal(cash, { business: { id: BIZ, name: 'x', country: 'EG', type: 'shop' }, deviceId: CASH.id, deviceCode: CASH.code }, newSyncKey(), cat, 'android', clock);
    await cash.update(users).set({ failedPinAttempts: 4, lockedUntil: clock + 60_000 });
    await installCatalog(cash, await buildCatalog(main, clock), CASH.id);
    expect((await cash.select().from(users))[0]).toMatchObject({ failedPinAttempts: 4, lockedUntil: clock + 60_000 });
  });

  it('a sale the main phone posted before a crash is recognised, not posted twice', async () => {
    const key = newSyncKey();
    const cash = createTestDb();
    await writeCashierLocal(cash, { business: { id: BIZ, name: 'x', country: 'EG', type: 'shop' }, deviceId: CASH.id, deviceCode: CASH.code }, key, await buildCatalog(main, clock), 'android', clock);
    const sara = await unlockWithPin(cash, cashierId, '258147');
    const cctx = { db: cash, user: sara, device: CASH, timezone: TZ, negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings } as SalesCtx;
    await postSale(cctx, { lines: [await cartLineFor(cash, settings, tea, null, 'retail', 1000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 2000 }]);
    const row = (await cash.select().from(syncOutbox))[0]!;
    setPhoneRole('main');
    const op = { deviceId: CASH.id, deviceCode: CASH.code, seq: row.seq, kind: 'sale', payload: JSON.parse(row.payload) };
    expect(await applyOp(main, op, { timezone: TZ, features: pro.features })).toBe('applied');
    await main.delete(syncApplied); // crash before the record (simulated)
    expect(await applyOp(main, op, { timezone: TZ, features: pro.features })).toBe('duplicate');
    expect(await main.select().from(salesDocs).where(eq(salesDocs.cashierId, cashierId))).toHaveLength(1);
    expect(await qtyOf(main, tea)).toBe(9000);
  });

  it('the catalog fingerprint ignores the build time and changes with the data', async () => {
    const a = await buildCatalog(main, 1);
    const b = await buildCatalog(main, 2);
    expect(catalogKey(a)).toBe(catalogKey(b));
    const owner = (await main.select().from(users).where(eq(users.name, 'أحمد')))[0]!;
    const ctx = { db: main, user: await toSessionUser(main, owner.id), device: MAIN, timezone: TZ, negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings } as SalesCtx;
    await postSale(ctx, { lines: [await cartLineFor(main, settings, tea, null, 'retail', 1000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 2000 }]);
    expect(catalogKey(await buildCatalog(main, 3))).not.toBe(catalogKey(a));
  });
});
