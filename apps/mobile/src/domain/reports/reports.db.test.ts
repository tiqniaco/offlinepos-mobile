import { beforeEach, describe, expect, it } from 'vitest';
import { businessDay, DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits, saveCategory } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { postAdjustment } from '../inventory/adjust';
import { trialBalance } from '../accounting/journal';
import { cartLineFor, postReturn, postSale, returnableLines, voidSale, type SalesCtx } from '../sales/sales';
import { saveParty } from '../parties/parties';
import { postPurchase, purchaseLineFor, type PurchaseCtx } from '../purchases/purchases';
import { ensureExpenseCategories, listExpenseCategories, postVoucher } from '../vouchers/vouchers';
import { saveOffer } from '../offers/offers';
import { rebuildRollup } from './rollup';
import { sql } from 'drizzle-orm';
import { aging, splitRange, dashboard, discountsByUser, profitAndLoss, purchasesBySupplier, salesBy, slowStock, stockMovementFor, stockValuation } from './reports';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner, , cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic: LicenceState = { mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
const user = (role = owner): SessionUser => ({ id: `u-${role.key}`, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: 10_000, maxInvoiceDiscountBp: 10_000, biometricEnabled: false });
const TZ = 'Africa/Cairo';

let db: Db;
let clock: number;
let ctx: SalesCtx & PurchaseCtx;
let tea: string;
let oil: string;
let day0: number;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 1, 8, 0, 0);
  day0 = businessDay(clock, TZ);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  await ensureExpenseCategories(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic);
  ctx = { db, user: user(), device: { id: 'dev-1', code: 'A' }, timezone: TZ, negativeStock: 'warn', features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: true, vatRateBp: 1400 }, vatRegistered: true, vatRateBp: 1400 };
  const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  const drinks = await saveCategory(ctx, { name: 'مشروبات' });
  tea = await createProduct(ctx, { name: 'شاي', categoryId: drinks, baseUnitId: piece, costMinor: 1000, retailPriceMinor: 2280, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['1'], openingQtyMilli: 100_000 });
  oil = await createProduct(ctx, { name: 'زيت', baseUnitId: piece, costMinor: 5000, retailPriceMinor: 7980, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['2'], openingQtyMilli: 20_000 });
});

const nextDay = () => (clock += 86_400_000);

async function scenario() {
  const c = await saveParty(ctx, 'C', { name: 'محمود' });
  const s = await saveParty(ctx, 'S', { name: 'مورد' });
  await saveOffer(ctx, { name: 'زيت 10%', type: 'PERCENT', active: true, scope: { productIds: [oil] }, valueBp: 1000 });
  const line = (p: string, q: number) => cartLineFor(db, ctx.settings, p, null, 'retail', q);
  const inv1 = await postSale(ctx, { lines: [await line(tea, 5000), await line(oil, 2000)], priceTier: 'retail', customerId: c, customerName: 'محمود' }, [{ method: 'cash', amountMinor: 10_000 }, { method: 'credit', amountMinor: 11_400 + 14_364 - 10_000 }]);
  nextDay();
  const cashierCtx = { ...ctx, user: user(cashier) };
  const inv2 = await postSale(cashierCtx, { lines: [await line(tea, 2000)], priceTier: 'retail', invoiceDiscount: { type: 'amount', minor: 560 } }, [{ method: 'cash', amountMinor: 4000 }]);
  const voided = await postSale(ctx, { lines: [await line(tea, 1000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 2280 }]);
  await voidSale(ctx, voided.docId, 'غلط');
  const [rl] = await returnableLines(db, inv1.docId);
  await postReturn(ctx, inv1.docId, [{ lineId: rl!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2280 }], 'x');
  const pl = { ...(await purchaseLineFor(db, ctx, oil, null, 10_000)), unitCostMinor: 5000 };
  await postPurchase(ctx, { supplierId: s, lines: [pl], pricesIncludeVat: false }, [{ method: 'credit', amountMinor: 57_000 }]);
  const cat = (await listExpenseCategories(db))[0]!;
  await postVoucher(ctx, { type: 'EXPENSE', categoryId: cat.id, amountMinor: 3000, method: 'cash' });
  await postAdjustment(ctx, { productId: tea, deltaMilli: -1000, reason: 'damaged' });
  return { c, s, inv1, inv2 };
}

describe('monthly roll-up', () => {
  it('splitRange: whole months vs edge days', () => {
    expect(splitRange({ from: 20261101, to: 20261130 })).toEqual({ edges: [], months: [202611, 202611] });
    expect(splitRange({ from: 20261105, to: 20261120 })).toEqual({ edges: [{ from: 20261105, to: 20261120 }], months: null });
    expect(splitRange({ from: 20261215, to: 20270310 })).toEqual({ edges: [{ from: 20261215, to: 20261231 }, { from: 20270301, to: 20270310 }], months: [202701, 202702] });
  });

  it('incremental roll-up (post, return, void) == full rebuild; month reports == line reports', async () => {
    await scenario();
    const snap = async () => db.all(sql`SELECT * FROM sales_rollup WHERE invoices != 0 OR qty_milli != 0 OR sales_minor != 0 OR cost_milli != 0 ORDER BY dim, key, month`);
    const incremental = await snap();
    await rebuildRollup(db);
    expect(await snap()).toEqual(incremental);
    for (const g of ['day', 'product', 'category', 'customer', 'user'] as const) {
      const viaMonth = await salesBy(db, g, { from: 20261101, to: 20261130 });
      const viaLines = await salesBy(db, g, { from: 20261101, to: 20261129 }); // all sales are on Nov 1–2
      expect(viaMonth).toEqual(viaLines);
    }
  });
});

describe('reports', () => {
  it('sales by day/product/category/customer/user: posted invoices − returns, voided excluded', async () => {
    await scenario();
    const today = businessDay(clock, TZ);
    const r = { from: day0, to: today };
    const byDay = await salesBy(db, 'day', r);
    const total = byDay.reduce((s, x) => s + x.salesMinor, 0);
    expect(total).toBe(11_400 + 14_364 + 4000 - 2280);
    const byProduct = await salesBy(db, 'product', r);
    expect(byProduct.find((x) => x.label === 'شاي')).toMatchObject({ qtyMilli: 6000 });
    expect(byProduct.find((x) => x.label === 'زيت')!.discountMinor).toBe(1596);
    expect((await salesBy(db, 'category', r)).find((x) => x.label === 'مشروبات')!.salesMinor).toBe(11_400 + 4000 - 2280);
    expect((await salesBy(db, 'customer', r)).find((x) => x.label === 'محمود')!.salesMinor).toBe(11_400 + 14_364 - 2280);
    const byUser = await salesBy(db, 'user', r);
    expect(byUser.find((x) => x.key === 'u-cashier')!.invoices).toBe(1);
    expect((await discountsByUser(db, r)).find((x) => x.key === 'u-cashier')!.invoiceMinor).toBe(560);
    expect((await discountsByUser(db, r)).find((x) => x.key === 'u-owner')!.offersMinor).toBe(1596);
    expect((await purchasesBySupplier(db, r))[0]).toMatchObject({ totalMinor: 57_000, creditMinor: 57_000 });
  });

  it('P&L from the journal reconciles with sales profit, and stock valuation == Inventory account', async () => {
    await scenario();
    const today = businessDay(clock, TZ);
    const r = { from: day0, to: today };
    const pnl = await profitAndLoss(db, r);
    const sales = await salesBy(db, 'day', r);
    const profitFromLines = sales.reduce((s, x) => s + x.profitMinor, 0);
    const netFromLines = sales.reduce((s, x) => s + x.netMinor, 0);
    expect(pnl.netSalesMinor).toBe(netFromLines);
    expect(pnl.grossProfitMinor).toBe(profitFromLines);
    expect(pnl.expensesMinor).toBe(3000);
    expect(pnl.stockAdjMinor).toBe(1000); // damaged tea at cost 10.00
    expect(pnl.netProfitMinor).toBe(profitFromLines - 3000 - 1000);
    const tb = await trialBalance(db);
    const valuation = (await stockValuation(db)).reduce((s, x) => s + x.valueMinor, 0);
    expect(valuation).toBe(tb.get('INVENTORY'));
  });

  it('dashboard, stock movement with running balance, slow stock, aging', async () => {
    const { c, s } = await scenario();
    const today = businessDay(clock, TZ);
    const d = await dashboard(db, today);
    expect(d.last30).toHaveLength(30);
    expect(d.todaySalesMinor).toBe(4000 - 2280);
    expect(d.receivablesMinor).toBe(11_400 + 14_364 - 10_000);
    expect(d.payablesMinor).toBe(57_000);
    expect(d.topItems[0]!.name).toBeTruthy();
    const mv = await stockMovementFor(db, tea, { from: day0, to: today });
    expect(mv.rows[0]!.type).toBe('OPENING');
    expect(mv.closingMilli).toBe(100_000 - 5000 - 2000 - 1000 + 1000 + 1000 - 1000);
    expect((await slowStock(db, today, 0)).map((x) => x.name)).toEqual(['زيت']); // tea sold today
    expect((await slowStock(db, addDays(today, 60), 30)).map((x) => x.name).sort()).toEqual(['زيت', 'شاي']);
    const ag = await aging(db, 'C', today);
    expect(ag[0]).toMatchObject({ id: c, totalMinor: 15_764 });
    expect((await aging(db, 'S', today))[0]).toMatchObject({ id: s, totalMinor: 57_000 });
  });
});

import { addDays } from '@daftarak/shared';
