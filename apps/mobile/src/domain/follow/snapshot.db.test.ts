import { beforeEach, describe, expect, it } from 'vitest';
import { businessDay, DEFAULT_PLANS, SNAPSHOT_MAX_BYTES, SYSTEM_ROLES, shopSnapshotSchema, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { cartLineFor, postSale, voidSale, type SalesCtx } from '../sales/sales';
import { ensureExpenseCategories, listExpenseCategories, postVoucher } from '../vouchers/vouchers';
import { openShift } from '../shifts/shifts';
import { buildSnapshot, snapshotKey } from './snapshot';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const owner = SYSTEM_ROLES[0]!;
const lic: LicenceState = { mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
const user: SessionUser = { id: 'u-owner', name: 'أحمد', color: '#000', roleId: 'r', roleKey: owner.key, roleName: owner.nameAr, permissions: owner.permissions, maxItemDiscountBp: 10_000, maxInvoiceDiscountBp: 10_000, biometricEnabled: false };
const TZ = 'Africa/Cairo';

let db: Db;
let clock: number;
let ctx: SalesCtx;
let tea: string;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 24, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  await ensureExpenseCategories(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic);
  ctx = { db, user, device: { id: 'dev-1', code: 'A' }, timezone: TZ, negativeStock: 'warn', features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 }, vatRegistered: false, vatRateBp: 0 } as SalesCtx;
  const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1000, retailPriceMinor: 2000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['1'], openingQtyMilli: 3000, lowStockMilli: 5000 });
});

describe('follower snapshot', () => {
  it('today, month, payments, shifts, low stock and recent invoices; valid for the server schema', async () => {
    await openShift({ ...ctx } as never, 50_000);
    const line = await cartLineFor(db, ctx.settings, tea, null, 'retail', 2000);
    await postSale(ctx, { lines: [line], priceTier: 'retail', customerName: 'محمود' }, [{ method: 'cash', amountMinor: 4000 }]);
    const v = await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, tea, null, 'retail', 1000)], priceTier: 'retail' }, [{ method: 'card', amountMinor: 2000 }]);
    await voidSale(ctx, v.docId, 'غلط');
    const cat = (await listExpenseCategories(db))[0]!;
    await postVoucher(ctx as never, { type: 'EXPENSE', categoryId: cat.id, amountMinor: 500, method: 'cash' });

    const day = businessDay(clock, TZ);
    const s = await buildSnapshot(db, day, 'EGP', clock);
    expect(shopSnapshotSchema.parse(s)).toEqual(s);
    expect(s.today).toMatchObject({ salesMinor: 4000, invoices: 1, returnsMinor: 0, expensesMinor: 500 });
    expect(s.today.byMethod).toEqual([{ method: 'cash', amountMinor: 4000 }]);
    expect(s.month.expensesMinor).toBe(500);
    expect(s.shifts).toEqual([expect.objectContaining({ user: 'أحمد', expectedCashMinor: 50_000 + 4000 - 500 })]);
    expect(s.lowItems).toEqual([{ name: 'شاي', qtyMilli: 1000 }]);
    expect(s.stock.low).toBe(1);
    expect(s.recent.map((r) => [r.status, r.totalMinor, r.party])).toEqual([['VOIDED', 2000, null], ['POSTED', 4000, 'محمود']]);
    expect(s.last14).toHaveLength(14);
    expect(JSON.stringify(s).length).toBeLessThan(SNAPSHOT_MAX_BYTES);

    // Same figures later → same key (nothing to send); a new sale changes it.
    const again = await buildSnapshot(db, day, 'EGP', clock + 60_000);
    expect(snapshotKey(again)).toBe(snapshotKey(s));
    await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, tea, null, 'retail', 500)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 1000 }]);
    expect(snapshotKey(await buildSnapshot(db, day, 'EGP', clock))).not.toBe(snapshotKey(s));
  });
});
