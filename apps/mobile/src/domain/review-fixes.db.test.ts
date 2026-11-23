/**
 * Review findings (B-series). Each test reproduces the original bug (it failed before the fix).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../test/testDb';
import type { Db } from '../db/types';
import { setLicenceState } from './licence/guard';
import type { SessionUser } from './auth/users';
import { ensureInventorySeed } from './inventory/seed';
import { listUnits } from './inventory/catalog';
import { createProduct, getProduct } from './inventory/products';
import { checkStockLevels } from './inventory/ledger';
import { trialBalance } from './accounting/journal';
import { verifyChain } from './integrity/chain';
import { postPurchase, purchaseLineFor, voidPurchase, type PurchaseCtx } from './purchases/purchases';
import { cartLineFor, postSale, type SalesCtx, type SaleDraft } from './sales/sales';
import { inventoryDocs, inventoryLines } from '../db/schema';
import { eq } from 'drizzle-orm';
import { listProducts } from './inventory/products';
import { quickAddStock } from './inventory/quickAdd';
import { buildListReview, listProblems, listToStockItems } from './inventory/listReview';
import { countItem, openCount, updateCountInfo } from './inventory/adjust';
import { saveCategory } from './inventory/catalog';
import { buildReview, reviewProblems } from './purchases/ocrMatch';
import { scanLineUnit, scanUnitOptions } from './purchases/scan';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0]];
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
const stockValueSum = async () => Number((await db.all<{ v: number }>(sql`SELECT coalesce(sum(value_minor), 0) AS v FROM stock_levels`))[0]!.v);
async function expectBooksMatchStock() {
  const tb = await trialBalance(db);
  expect(tb.get('INVENTORY') ?? 0).toBe(await stockValueSum());
  expect([...tb.values()].reduce((a, b) => a + b, 0)).toBe(0);
  expect(await checkStockLevels(db)).toEqual([]);
}

describe('B1 voiding a purchase keeps INVENTORY = Σ stock values', () => {
  it('purchase that reset a negative average (true-up to COGS), then voided', async () => {
    await postSale(ctx, await draft([oil, 12_000]), [{ method: 'cash', amountMinor: 12 * 7980 }]); // 10 → −2 @ 60.00
    const line = await purchaseLineFor(db, ctx, oil, null, 10_000);
    const p = await postPurchase(ctx, { lines: [{ ...line, unitCostMinor: 7000 }], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: 79_800 }]);
    await expectBooksMatchStock();
    await voidPurchase(ctx, p.docId, 'غلط');
    expect((await getProduct(db, oil))!.level.qtyMilli).toBe(-2000);
    await expectBooksMatchStock(); // was INVENTORY 168000 vs stock 166000
    expect((await trialBalance(db)).get('COGS')).toBe(12 * 6000 + 2 * 1000); // the 2 oversold units stay at 70.00
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
  });
  it('a normal void (average drift from a later sale) also matches', async () => {
    const line = await purchaseLineFor(db, ctx, tea, null, 7000);
    const p = await postPurchase(ctx, { lines: [{ ...line, unitCostMinor: 1703 }], pricesIncludeVat: false }, [{ method: 'cash', amountMinor: Math.round(7 * 1703 * 1.14) }]);
    await postSale(ctx, await draft([tea, 3000]), [{ method: 'cash', amountMinor: 3 * 2280 }]);
    await voidPurchase(ctx, p.docId, 'غلط');
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(97_000);
    await expectBooksMatchStock();
  });
});

const pricing = { markupBp: 2000, stepMinor: 50 };
/** Shop products as the list review screen loads them (with each product's own units). */
const shopProducts = async () => Promise.all((await listProducts(db, { limit: 10_000 })).map(async (p) => ({ id: p.id, name: p.name, qtyMilli: p.qtyMilli, units: await scanUnitOptions(db, p.id) })));

describe('B2 a unit word the existing product does not have', () => {
  it('«2 كرتونة» of a product with no carton unit is refused, never 2 pieces at the carton cost', async () => {
    const before = (await getProduct(db, oil))!.level;
    await expect(quickAddStock(ctx, [{ productId: oil, unit: 'كرتونة', qtyMilli: 2000, costMinor: 72_000 }])).rejects.toMatchObject({ code: 'unit_mismatch' });
    expect((await getProduct(db, oil))!.level).toEqual(before); // avg cost did not jump
    // A productUnitId of another product is refused too.
    const teaCarton = (await getProduct(db, tea))!.units.find((u) => !u.isBase)!.id;
    await expect(quickAddStock(ctx, [{ productId: oil, productUnitId: teaCarton, qtyMilli: 2000 }])).rejects.toMatchObject({ code: 'unit_mismatch' });
    // A word it does have works.
    await quickAddStock(ctx, [{ productId: tea, unit: 'كرتونه', qtyMilli: 2000 }]);
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(100_000 + 48_000);
  });
  it('list review: the row picks the product unit named by the word, else needs a unit choice', async () => {
    const rows = buildListReview(
      [
        { name: 'شاي', qty: 2, unit: 'كرتونة', cost: null, price: null },
        { name: 'زيت', qty: 2, unit: 'كرتونة', cost: null, price: null },
        { name: 'زيت', qty: 5, unit: null, cost: null, price: null },
      ],
      await shopProducts(),
      { autoCreate: true, pricing },
    );
    const teaCarton = (await getProduct(db, tea))!.units.find((u) => !u.isBase)!.id;
    expect(rows[0]).toMatchObject({ productUnitId: teaCarton, unitUnsure: false });
    expect(rows[1]).toMatchObject({ productUnitId: null, unitUnsure: true });
    expect(listProblems(rows[1]!)).toEqual(['unit']);
    expect(listToStockItems(rows)).toEqual([
      { productId: tea, productUnitId: teaCarton, qtyMilli: 2000, costMinor: null },
      { productId: oil, productUnitId: expect.any(String), qtyMilli: 5000, costMinor: null },
    ]);
  });
});

describe('B3 photographed paper count sets existing products to the counted quantity', () => {
  it("'count': delta = counted − current as a COUNT document; new products still get opening stock", async () => {
    const rows = buildListReview(
      [
        { name: 'شاي', qty: 100, unit: null, cost: null, price: null }, // same as the system: no change
        { name: 'زيت', qty: 7, unit: null, cost: null, price: null }, // system 10 → 7
        { name: 'سكر', qty: 4, unit: null, cost: 20, price: 25 }, // new
      ],
      await shopProducts(),
      { autoCreate: true, pricing },
    );
    const r = await quickAddStock(ctx, listToStockItems(rows), { source: 'list_scan', existing: 'count' });
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(100_000); // was 200 (added on top)
    expect((await getProduct(db, oil))!.level.qtyMilli).toBe(7000); // was 17
    expect(r.created).toBe(1);
    expect((await getProduct(db, r.productIds[2]!))!.level.qtyMilli).toBe(4000);
    const count = (await db.select().from(inventoryDocs).where(eq(inventoryDocs.id, r.countDocId!)))[0]!;
    expect(count).toMatchObject({ type: 'COUNT', status: 'POSTED' });
    const lines = await db.select().from(inventoryLines).where(eq(inventoryLines.docId, count.id));
    expect(lines.find((l) => l.productId === oil)).toMatchObject({ expectedMilli: 10_000, countedMilli: 7000, deltaMilli: -3000 });
    expect(lines.find((l) => l.productId === tea)).toMatchObject({ expectedMilli: 100_000, countedMilli: 100_000, deltaMilli: 0 });
    // Only the new product went in as opening stock.
    const opening = await db.select().from(inventoryLines).where(eq(inventoryLines.docId, r.openingDocId!));
    expect(opening.map((l) => l.productId)).toEqual([r.productIds[2]]);
    expect((await trialBalance(db)).get('STOCK_ADJ')).toBe(3 * 6000); // the 3 missing oil at the average
    await expectBooksMatchStock();
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
  });
  it("'count' in a carton unit, and 'add' still adds on top (delivery list)", async () => {
    const teaCarton = (await getProduct(db, tea))!.units.find((u) => !u.isBase)!.id;
    await quickAddStock(ctx, [{ productId: tea, productUnitId: teaCarton, qtyMilli: 3000 }], { existing: 'count' });
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(72_000);
    await quickAddStock(ctx, [{ productId: oil, qtyMilli: 5000 }], { existing: 'add' });
    expect((await getProduct(db, oil))!.level.qtyMilli).toBe(15_000);
    await expectBooksMatchStock();
  });
});

describe('B4 scanned invoice: the printed unit word picks the product unit', () => {
  it('«كرتونة» picks the carton even when the product cost is 0; a missing larger unit is never silently the base', async () => {
    const box = await createProduct(ctx, { name: 'بسكويت', baseUnitId: piece, costMinor: 0, retailPriceMinor: 500, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [], largerUnit: { unitId: carton, factorMilli: 12_000, retailPriceMinor: 5500, wholesalePriceMinor: null, barcode: null } });
    const boxCarton = (await getProduct(db, box))!.units.find((u) => !u.isBase)!.id;
    expect(await scanLineUnit(db, box, 4800, 'كرتونه')).toEqual({ unitId: boxCarton, unsure: false }); // was the base unit (cost 0)
    // oil has pieces only; «كرتونة» at 720.00 with a piece at 60.00 → not silently a piece.
    const oilPiece = (await getProduct(db, oil))!.units.find((u) => u.isBase)!.id;
    expect(await scanLineUnit(db, oil, 72_000, 'كرتونة')).toEqual({ unitId: oilPiece, unsure: true });
    expect(await scanLineUnit(db, oil, 6000, 'كرتونة')).toEqual({ unitId: oilPiece, unsure: false }); // the price says a piece
    // No cost, word names a larger unit the product lacks → must pick.
    const plain = await createProduct(ctx, { name: 'ملح', baseUnitId: piece, costMinor: 0, retailPriceMinor: 300, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [] });
    expect((await scanLineUnit(db, plain, 3000, 'كرتونة')).unsure).toBe(true);
    const review = buildReview([{ name: 'ملح', qty: 2, unitPrice: 30, total: 60, unit: 'كرتونة' }], [{ id: plain, name: 'ملح' }]);
    expect(review[0]!.unitWord).toBe('كرتونة');
    expect(reviewProblems({ ...review[0]!, unitUnsure: true })).toContain('unit');
  });
});

describe('count re-scope after scanning', () => {
  it('narrowing to a category is refused while products outside it are counted', async () => {
    const cat = await saveCategory(ctx, { name: 'مشروبات' });
    const id = await openCount(ctx);
    await countItem(ctx, id, oil, 5000);
    await expect(updateCountInfo(ctx, id, { categoryId: cat })).rejects.toMatchObject({ code: 'scope_has_lines', detail: { n: 1, name: 'زيت' } });
    await updateCountInfo(ctx, id, { categoryId: null, note: 'كله' }); // widening / renaming is fine
  });
});
