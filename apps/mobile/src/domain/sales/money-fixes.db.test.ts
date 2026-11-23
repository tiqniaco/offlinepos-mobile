/**
 * Pre-launch money / stock correctness fixes. Each test reproduces the original bug (it failed before the fix).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { payments, products, stockLevels, stockMovements } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct, getProduct } from '../inventory/products';
import { checkStockLevels } from '../inventory/ledger';
import { countItem, openCount, postAdjustment, postCount } from '../inventory/adjust';
import { partyBalance } from '../parties/customers';
import { saveParty } from '../parties/parties';
import { trialBalance } from '../accounting/journal';
import { verifyChain } from '../integrity/chain';
import { saveOffer } from '../offers/offers';
import { closeShift, openShift } from '../shifts/shifts';
import { postPurchase, purchaseLineFor, voidPurchase, type PurchaseCtx } from '../purchases/purchases';
import { buildReview, reviewProblems } from '../purchases/ocrMatch';
import { defaultScanUnit, scanPurchaseLines, scanTotals } from '../purchases/scan';
import { salesBy, salesRounding, stockValuation, stockValuationTotals } from '../reports/reports';
import { cartLineFor, getSale, loadDraft, parkSale, postReturn, postSale, previewReturn, priceDraft, returnableLines, voidSale, type SalesCtx, type SaleDraft } from './sales';
import { loadOffers } from '../offers/offers';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner, manager, cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic = (): LicenceState => ({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user = (role = owner, id = `u-${role.key}`): SessionUser => ({ id, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false });

let db: Db;
let ctx: SalesCtx & PurchaseCtx;
let clock: number;
let tea: string;
let oil: string;
let piece: string;
let carton: string;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = {
    db,
    user: user(),
    device: { id: 'dev-1', code: 'A' },
    timezone: 'Africa/Cairo',
    negativeStock: 'warn',
    features: pro.features,
    now: () => (clock += 1000),
    settings: { pricesIncludeVat: true, vatRegistered: true, vatRateBp: 1400 },
    vatRegistered: true,
    vatRateBp: 1400,
  };
  const us = await listUnits(db);
  piece = us.find((u) => u.nameAr === 'قطعة')!.id;
  carton = us.find((u) => u.nameAr === 'كرتونة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1800, retailPriceMinor: 2280, wholesalePriceMinor: 2000, trackStock: true, trackExpiry: false, barcodes: ['111'], largerUnit: { unitId: carton, factorMilli: 24_000, retailPriceMinor: 50_000, wholesalePriceMinor: null, barcode: '222' }, openingQtyMilli: 100_000 });
  oil = await createProduct(ctx, { name: 'زيت', baseUnitId: piece, costMinor: 6000, retailPriceMinor: 7980, wholesalePriceMinor: 7500, trackStock: true, trackExpiry: false, barcodes: ['333'], openingQtyMilli: 10_000 });
});

async function draft(...items: [productId: string, qty: number][]): Promise<SaleDraft> {
  const lines = [];
  for (const [pid, qty] of items) lines.push(await cartLineFor(db, ctx.settings, pid, null, 'retail', qty));
  return { lines, priceTier: 'retail' };
}
const customer = (limit: number | null = null) => saveParty(ctx, 'C', { name: 'عميل', creditLimitMinor: limit });
const stockValueSum = async () => Number((await db.all<{ v: number }>(sql`SELECT coalesce(sum(value_minor), 0) AS v FROM stock_levels`))[0]!.v);
async function expectBooksMatchStock() {
  expect((await trialBalance(db)).get('INVENTORY') ?? 0).toBe(await stockValueSum());
  expect(await checkStockLevels(db)).toEqual([]);
}

describe('H1/M6/M7 scanned purchase invoice', () => {
  it('a carton line goes in as cartons (24 pieces each), not as 2 pieces at the carton price', async () => {
    const review = buildReview([{ name: 'شاي', qty: 2, unitPrice: 432, total: 864 }], [{ id: tea, name: 'شاي' }]);
    review[0]!.unitId = await defaultScanUnit(db, review[0]!.product!.id, review[0]!.costMinor);
    const lines = await scanPurchaseLines(db, ctx, review);
    expect(lines[0]).toMatchObject({ factorMilli: 24_000, qtyMilli: 2000, unitCostMinor: 43_200 });
    await postPurchase(ctx, { lines, pricesIncludeVat: false }, [{ method: 'cash', amountMinor: 98_496 }]);
    const p = (await getProduct(db, tea))!;
    expect(p.level.qtyMilli).toBe(148_000); // was 102 pieces at 432.00 each
    expect(p.level.avgCostMinor).toBe(1800);
    await expectBooksMatchStock();
  });

  it('printed discount + VAT mode are carried, totals compared; missing qty needs review; line total kept exactly', async () => {
    const review = buildReview(
      [
        { name: 'شاي', qty: 2, unitPrice: 432, total: 864 },
        { name: 'زيت', qty: 0, unitPrice: 60, total: null },
      ],
      [{ id: tea, name: 'شاي' }, { id: oil, name: 'زيت' }],
    );
    expect(review[1]!.qtyMilli).toBe(0); // was silently 1
    expect(reviewProblems(review[1]!)).toContain('qty');
    review[0]!.unitId = await defaultScanUnit(db, tea, review[0]!.costMinor);
    const built = await scanPurchaseLines(db, ctx, [review[0]!]);
    // 864 − 10 discount = 854, + 14% VAT = 973.56 → VAT exclusive
    const ok = scanTotals(built, { discount: 10, tax: 119.56, total: 973.56 }, true);
    expect(ok).toMatchObject({ pricesIncludeVat: false, invoiceDiscountMinor: 1000, computedTotalMinor: 97_356, mismatch: false });
    expect(scanTotals(built, { discount: 10, tax: 119.56, total: 1200 }, true).mismatch).toBe(true);
    expect(scanTotals(built, { discount: null, tax: 0, total: 864 }, true)).toMatchObject({ zeroTax: true, computedTotalMinor: 86_400, mismatch: false });
    // Only the line total is printed: 3 for 100.00 → the line still totals exactly 100.00.
    const r2 = buildReview([{ name: 'زيت', qty: 3, unitPrice: null, total: 100 }], [{ id: oil, name: 'زيت' }]);
    const l2 = await scanPurchaseLines(db, ctx, r2);
    expect(scanTotals(l2, { discount: null, tax: 0, total: 100 }, true).computedTotalMinor).toBe(10_000);
  });

  it('raw-substring look-alikes are not pre-selected; whole-word matches need confirmation', () => {
    const r = buildReview([{ name: 'سكر', qty: 1, unitPrice: 10, total: 10 }, { name: 'شاي ناعم', qty: 1, unitPrice: 10, total: 10 }], [{ id: 'x', name: 'سكرية' }, { id: tea, name: 'شاي' }]);
    expect(r[0]).toMatchObject({ product: null, suggestion: { id: 'x' } });
    expect(r[1]).toMatchObject({ product: { id: tea }, match: 'contains' });
    expect(reviewProblems(r[1]!)).toEqual(['confirm']);
  });
});

describe('H2 returns of a credit invoice', () => {
  it('a full-credit invoice is returned to the balance, never paid out in cash', async () => {
    const c = await customer();
    const inv = await postSale(ctx, { ...(await draft([oil, 1000])), customerId: c }, [{ method: 'credit', amountMinor: 7980 }]);
    const [l] = await returnableLines(db, inv.docId);
    const r = await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 7980 }], 'x');
    expect(r.creditMinor).toBe(7980);
    expect(await partyBalance(db, 'C', c)).toBe(0);
    expect((await trialBalance(db)).get('CASH') ?? 0).toBe(0); // was −79.80 cash out of the drawer
  });
  it('a part-paid invoice refunds cash only up to what was paid (across returns)', async () => {
    const c = await customer();
    const inv = await postSale(ctx, { ...(await draft([oil, 2000])), customerId: c }, [{ method: 'cash', amountMinor: 3000 }, { method: 'credit', amountMinor: 12_960 }]);
    const [l] = await returnableLines(db, inv.docId);
    await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 7980 }], 'x');
    await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 7980 }], 'x');
    const out = await db.select().from(payments).where(and(eq(payments.kind, 'REFUND'), eq(payments.method, 'cash')));
    expect(out.reduce((s, p) => s + p.amountMinor, 0)).toBe(3000);
    expect(await partyBalance(db, 'C', c)).toBe(0);
    expect((await trialBalance(db)).get('CASH')).toBe(0);
  });
});

describe('H3 journal INVENTORY = Σ stock values', () => {
  it('selling into negative stock then buying at a new cost', async () => {
    await postSale(ctx, await draft([oil, 12_000]), [{ method: 'cash', amountMinor: 12 * 7980 }]); // 10 → −2 @ 60.00
    const line = await purchaseLineFor(db, ctx, oil, null, 10_000);
    await postPurchase(ctx, { lines: [{ ...line, unitCostMinor: 7000 }], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: 79_800 }]);
    expect((await getProduct(db, oil))!.level).toMatchObject({ qtyMilli: 8000, valueMinor: 56_000 });
    await expectBooksMatchStock(); // journal had 580.00 vs stock 560.00
    expect((await trialBalance(db)).get('COGS')).toBe(12 * 6000 + 2 * 1000); // the 2 oversold units really cost 70.00
  });
  it('no rounding drift with odd costs, partial sales, returns, voids and counts', async () => {
    for (const cost of [101, 103, 107]) {
      const line = await purchaseLineFor(db, ctx, tea, null, 3000);
      await postPurchase(ctx, { lines: [{ ...line, unitCostMinor: cost }], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: Math.round(cost * 3 * 1.14) }]);
    }
    const s1 = await postSale(ctx, await draft([tea, 7000]), [{ method: 'cash', amountMinor: 7 * 2280 }]);
    const s2 = await postSale(ctx, await draft([tea, 1000], [oil, 11_000]), [{ method: 'cash', amountMinor: 2280 + 11 * 7980 }]);
    const [rl] = await returnableLines(db, s1.docId);
    await postReturn(ctx, s1.docId, [{ lineId: rl!.lineId, qtyMilli: 3000 }], [{ method: 'cash', amountMinor: 3 * 2280 }], 'x');
    await voidSale(ctx, s2.docId, 'خطأ');
    await postAdjustment(ctx, { productId: tea, deltaMilli: -1000, reason: 'damaged' });
    await expectBooksMatchStock();
  });
});

describe('H4 stock count while selling', () => {
  it('sales made after the product was counted are not wiped by posting the count', async () => {
    const id = await openCount(ctx);
    await countItem(ctx, id, tea, 95_000, 'set'); // shelf: 95 (5 missing), system: 100
    await postSale(ctx, await draft([tea, 3000]), [{ method: 'cash', amountMinor: 3 * 2280 }]);
    await postCount(ctx, id);
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(92_000); // was 95 (the 3 sold came back)
  });
});

describe('M1 clock behind the chain', () => {
  it('every posting path refuses a clock before the last posted document', async () => {
    const s = await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    const line = await purchaseLineFor(db, ctx, oil, null, 1000);
    const p = await postPurchase(ctx, { lines: [line], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: 6840 }]);
    await openShift(ctx, 0);
    clock -= 3_600_000;
    await expect(postAdjustment(ctx, { productId: tea, deltaMilli: -1000, reason: 'damaged' })).rejects.toMatchObject({ code: 'clock_behind' });
    const id = await openCount(ctx);
    await countItem(ctx, id, tea, 1000);
    await expect(postCount(ctx, id)).rejects.toMatchObject({ code: 'clock_behind' });
    await expect(voidSale(ctx, s.docId, 'x')).rejects.toMatchObject({ code: 'clock_behind' });
    await expect(voidPurchase(ctx, p.docId, 'x')).rejects.toMatchObject({ code: 'clock_behind' });
    await expect(createProduct(ctx, { name: 'سكر', baseUnitId: piece, costMinor: 100, retailPriceMinor: 150, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [], openingQtyMilli: 5000 })).rejects.toMatchObject({ code: 'clock_behind' });
    await expect(closeShift(ctx, 0)).rejects.toMatchObject({ code: 'clock_behind' });
    expect(await verifyChain(db, 'dev-1')).toMatchObject({ ok: true });
  });
  it('the stock rebuild replays in insertion order, not by timestamp', async () => {
    await postSale(ctx, await draft([oil, 12_000]), [{ method: 'cash', amountMinor: 12 * 7980 }]);
    const line = await purchaseLineFor(db, ctx, oil, null, 10_000);
    await postPurchase(ctx, { lines: [{ ...line, unitCostMinor: 7000 }], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: 79_800 }]);
    // Same timestamps (or a clock that moved) must not reorder the replay. (Test-only: lift the append-only guard.)
    await db.run(sql`DROP TRIGGER stock_movements_no_update`);
    await db.run(sql`UPDATE stock_movements SET occurred_at = 0 WHERE type = 'PURCHASE'`);
    expect(await checkStockLevels(db)).toEqual([]);
  });
});

describe('M2 buy-X-get-Y return loophole', () => {
  it('returning units the offer was earned with deducts the free unit the customer keeps', async () => {
    await saveOffer(ctx, { name: '2+1', type: 'BUY_X_GET_Y', active: true, scope: { productIds: [tea] }, buyQtyMilli: 2000, getQtyMilli: 1000, valueBp: 10_000 });
    const inv = await postSale(ctx, await draft([tea, 3000]), [{ method: 'cash', amountMinor: 4560 }]);
    expect(inv.totalMinor).toBe(4560);
    const [l] = await returnableLines(db, inv.docId);
    // Keeping 2 units costs 2 × 22.80 = 45.60 = everything paid → nothing back (was 15.20).
    expect(await previewReturn(db, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }])).toBe(0);
    await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 0 }], 'x');
    const r2 = await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2280 }], 'x');
    expect(r2.totalMinor).toBe(2280);
    const r3 = await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2280 }], 'x');
    expect(r3.totalMinor).toBe(2280);
    expect((await trialBalance(db)).get('CASH')).toBe(0);
  });
  it('separate get-product: returning the bought line while keeping the free item refunds bought − free value', async () => {
    await saveOffer(ctx, { name: 'شاي هدية', type: 'BUY_X_GET_Y', active: true, scope: { productIds: [oil] }, buyQtyMilli: 1000, getQtyMilli: 1000, getProductId: tea, valueBp: 10_000 });
    const inv = await postSale(ctx, await draft([oil, 1000], [tea, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    expect(inv.totalMinor).toBe(7980);
    const ls = await returnableLines(db, inv.docId);
    const oilLine = ls.find((x) => x.productId === oil)!;
    expect(await previewReturn(db, inv.docId, [{ lineId: oilLine.lineId, qtyMilli: 1000 }])).toBe(7980 - 2280); // was 79.80
  });
});

describe('M3 product-scoped coupon', () => {
  it('is shared only by the lines it applies to', async () => {
    await saveOffer(ctx, { name: 'كوبون الشاي', type: 'COUPON', active: true, scope: { productIds: [tea] }, couponCode: 'TEA5', valueMinor: 500 });
    const d = { ...(await draft([tea, 1000], [oil, 1000])), couponCode: 'TEA5' };
    const priced = priceDraft(d, ctx.settings, { offers: await loadOffers(db), day: 20261122 });
    expect(priced.couponMinor).toBe(500);
    expect(priced.lines.map((l) => l.invoiceDiscountMinor)).toEqual([500, 0]); // oil got most of it before
  });
});

describe('M4 resuming a held sale', () => {
  it('uses today’s price; a manual price stays only for a user who may change prices', async () => {
    const d = await draft([tea, 2000], [oil, 1000]);
    d.lines[1]!.unitPriceMinor = 7000; // manual price
    const id = await parkSale(ctx, d);
    await db.update(products).set({ retailPriceMinor: 2500 }).where(eq(products.id, tea));
    await db.update(products).set({ retailPriceMinor: 8500 }).where(eq(products.id, oil));
    const asCashier = await loadDraft(db, id, { settings: ctx.settings, user: user(cashier, 'u-c') });
    expect(asCashier.lines.map((l) => l.unitPriceMinor)).toEqual([2500, 8500]); // was 2280 (old price) / 7000
    expect(asCashier.repriced).toEqual({ changed: 2, reverted: 1 });
    const asOwner = await loadDraft(db, id, { settings: ctx.settings, user: user() });
    expect(asOwner.lines.map((l) => [l.unitPriceMinor, l.catalogPriceMinor])).toEqual([[2500, 2500], [7000, 8500]]);
  });
});

describe('M5 cash rounding on returns and reports', () => {
  beforeEach(() => {
    ctx.settings = { ...ctx.settings, cashRoundingMinor: 50 };
  });
  it('a full return refunds exactly what was paid; partial returns are rounded; reports carry the rounding', async () => {
    const inv = await postSale(ctx, await draft([tea, 3000]), [{ method: 'cash', amountMinor: 6850 }]);
    expect(inv.totalMinor).toBe(6850); // 68.40 → 68.50
    const [l] = await returnableLines(db, inv.docId);
    const r1 = await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2300 }], 'x');
    expect(r1.totalMinor).toBe(2300); // 22.80 → 23.00
    const r2 = await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 2000 }], [{ method: 'cash', amountMinor: 4550 }], 'x');
    expect(r2.totalMinor).toBe(4550); // 45.60 + 0.10 − 0.20 → everything paid comes back, no more
    const tb = await trialBalance(db);
    expect(tb.get('CASH')).toBe(0);
    expect(tb.get('ROUNDING') ?? 0).toBe(0);
    const day = (await getSale(db, inv.docId))!.doc.businessDay!;
    const lines = (await salesBy(db, 'day', { from: day, to: day })).reduce((s, r) => s + r.salesMinor, 0);
    expect(lines + (await salesRounding(db, { from: day, to: day }))).toBe(6850 - 2300 - 4550);
  });
});

describe('L1 credit limit', () => {
  it('a credit sale over the limit needs a manager', async () => {
    const c = await customer(5000);
    const d = { ...(await draft([oil, 1000])), customerId: c };
    await expect(postSale(ctx, d, [{ method: 'credit', amountMinor: 7980 }])).rejects.toMatchObject({ code: 'credit_limit' });
    await expect(postSale(ctx, d, [{ method: 'credit', amountMinor: 7980 }], { approvedBy: user(cashier, 'u-c2') })).rejects.toMatchObject({ code: 'credit_limit' });
    await postSale(ctx, d, [{ method: 'cash', amountMinor: 3000 }, { method: 'credit', amountMinor: 4980 }]); // within the limit
    await postSale(ctx, d, [{ method: 'credit', amountMinor: 7980 }], { approvedBy: user(manager, 'u-m') });
    expect(await partyBalance(db, 'C', c)).toBe(4980 + 7980);
  });
});

describe('L3 / L4 / L5 / L6 / L8 / M8', () => {
  it('L3 voiding a purchase restores the product cost', async () => {
    const line = await purchaseLineFor(db, ctx, tea, null, 10_000);
    const p = await postPurchase(ctx, { lines: [{ ...line, unitCostMinor: 2000 }], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: 22_800 }]);
    expect((await getProduct(db, tea))!.product.costMinor).toBe(2000);
    await voidPurchase(ctx, p.docId, 'خطأ');
    expect((await getProduct(db, tea))!.product.costMinor).toBe(1800);
  });
  it('L4 a one-use coupon cannot be used twice by two sales loaded at the same time', async () => {
    await saveOffer(ctx, { name: 'مرة واحدة', type: 'COUPON', active: true, scope: { all: true }, couponCode: 'ONCE', valueMinor: 500, maxUses: 1 });
    const d = { ...(await draft([oil, 1000])), couponCode: 'ONCE' };
    const res = await Promise.allSettled([postSale(ctx, d, [{ method: 'cash', amountMinor: 7480 }]), postSale(ctx, d, [{ method: 'cash', amountMinor: 7480 }])]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(res.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'coupon_invalid' } });
  });
  it('L5 untracked items are costed at the product cost in profit reports', async () => {
    const svc = await createProduct(ctx, { name: 'تغليف', baseUnitId: piece, costMinor: 500, retailPriceMinor: 1140, wholesalePriceMinor: 0, trackStock: false, trackExpiry: false, barcodes: [] });
    const inv = await postSale(ctx, await draft([svc, 1000]), [{ method: 'cash', amountMinor: 1140 }]);
    const day = (await getSale(db, inv.docId))!.doc.businessDay!;
    const row = (await salesBy(db, 'product', { from: day, to: day })).find((r) => r.key === svc)!;
    expect(row.profitMinor).toBe(1000 - 500); // was 10.00 (no cost)
  });
  it('L6 valuation leaves negative stock out of the value and rounds retail value', async () => {
    const odd = await createProduct(ctx, { name: 'عسل', baseUnitId: piece, costMinor: 700, retailPriceMinor: 1001, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [], openingQtyMilli: 1500 });
    await postSale(ctx, await draft([oil, 12_000]), [{ method: 'cash', amountMinor: 12 * 7980 }]);
    const rows = await stockValuation(db);
    expect(rows.find((r) => r.id === odd)!.retailValueMinor).toBe(1502); // 1501.5 (was 1501)
    const tot = stockValuationTotals(rows);
    expect(tot.negativeMinor).toBe(-12_000);
    expect(tot.valueMinor).toBe(100 * 1800 + 1050); // oil's −120.00 no longer lowers the stock value
  });
  it('L8 returning an item whose stock tracking was switched off moves no stock', async () => {
    const inv = await postSale(ctx, await draft([tea, 2000]), [{ method: 'cash', amountMinor: 4560 }]);
    await db.update(products).set({ trackStock: false }).where(eq(products.id, tea));
    const [l] = await returnableLines(db, inv.docId);
    await postReturn(ctx, inv.docId, [{ lineId: l!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2280 }], 'x');
    expect(await db.select().from(stockMovements).where(and(eq(stockMovements.productId, tea), eq(stockMovements.type, 'SALE_RETURN')))).toHaveLength(0);
    expect((await db.select().from(stockLevels).where(eq(stockLevels.productId, tea)))[0]!.qtyMilli).toBe(98_000);
  });
  it('M8 a gram base unit with a sub-piastre-precision price is refused (use kilo)', async () => {
    const us = await listUnits(db);
    const gram = us.find((u) => u.nameEn === 'Gram')!.id;
    const kilo = us.find((u) => u.nameEn === 'Kg')!.id;
    await expect(createProduct(ctx, { name: 'كمون', baseUnitId: gram, costMinor: 9, retailPriceMinor: 13, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [] })).rejects.toMatchObject({ code: 'gram_base_unit' });
    await createProduct(ctx, { name: 'كمون', baseUnitId: kilo, costMinor: 9000, retailPriceMinor: 12_550, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [] });
  });
});
