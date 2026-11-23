import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { inventoryDocs, products, units } from '../../db/schema';
import { ProductLimitError, setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from './seed';
import { listUnits } from './catalog';
import { confirmSalePrice, countNeedsPriceReview, createProduct, findByBarcode, getProduct, listProducts, updateProduct } from './products';
import { checkStockLevels } from './ledger';
import { quickAddStock, resolveUnitId } from './quickAdd';
import { InventoryError } from './context';
import { buildReview } from '../purchases/ocrMatch';
import { buildListReview, listToStockItems } from './listReview';
import { scanPurchaseLines, scanTotals, scanUnitOptions } from '../purchases/scan';
import { postPurchase, type PurchaseCtx } from '../purchases/purchases';
import { trialBalance } from '../accounting/journal';
import { verifyChain } from '../integrity/chain';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const owner = SYSTEM_ROLES[0]!;
const lic = (products = pro.limits.products): LicenceState => ({ mode: 'full', reason: 'ok', plan: 'pro', limits: { ...pro.limits, products }, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user: SessionUser = { id: 'u-owner', name: 'owner', color: '#000', roleId: 'r', roleKey: owner.key, roleName: owner.nameAr, permissions: owner.permissions, maxItemDiscountBp: owner.maxItemDiscountBp, maxInvoiceDiscountBp: owner.maxInvoiceDiscountBp, biometricEnabled: false };
const pricing = { markupBp: 2000, stepMinor: 50 };

let db: Db;
let clock: number;
let ctx: PurchaseCtx;
let tea: string;
let piece: string;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = { db, user, device: { id: 'dev-1', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn', features: pro.features, now: () => (clock += 1000), vatRegistered: false, vatRateBp: 1400 };
  const us = await listUnits(db);
  piece = us.find((u) => u.nameAr === 'قطعة')!.id;
  const carton = us.find((u) => u.nameAr === 'كرتونة')!.id;
  tea = await createProduct(ctx, { name: 'شاي العروسة', baseUnitId: piece, costMinor: 1800, retailPriceMinor: 2200, wholesalePriceMinor: 2000, trackStock: true, trackExpiry: false, barcodes: ['111'], largerUnit: { unitId: carton, factorMilli: 24_000, retailPriceMinor: 50_000, wholesalePriceMinor: null, barcode: null } });
});

const shopProducts = async () => Promise.all((await listProducts(db, { limit: 10_000 })).map(async (p) => ({ id: p.id, name: p.name, units: await scanUnitOptions(db, p.id) })));
const byName = async (name: string) => (await db.select().from(products).where(and(eq(products.name, name), isNull(products.deletedAt))))[0];
const stock = async (id: string) => (await getProduct(db, id))!.level.qtyMilli;

/** OCR result of a supplier invoice: one known product, two unknown ones (one in «كيس», a unit the shop lacks). */
const INVOICE = {
  supplierName: null,
  invoiceNo: 'F-9',
  date: null,
  currency: 'EGP',
  lines: [
    { name: 'شاي العروسة', qty: 10, unitPrice: 18, total: 180 },
    { name: 'مناديل فاين كرتونة', qty: 2, unitPrice: 123.4, total: 246.8 },
    { name: 'سكر ابيض', qty: 5, unitPrice: 30, total: 150, unit: 'كيس' },
  ],
  subtotal: 576.8,
  discount: null,
  tax: null,
  total: 576.8,
  used: 1,
  limit: 150,
};

async function postScan(scan = INVOICE) {
  const review = buildReview(scan.lines, await shopProducts(), { autoCreate: true, pricing });
  const tot = scanTotals(await scanPurchaseLines(db, ctx, review), scan, ctx.vatRegistered);
  expect(tot.mismatch).toBe(false);
  return postPurchase(ctx, { lines: tot.lines, pricesIncludeVat: tot.pricesIncludeVat, invoiceDiscountMinor: tot.invoiceDiscountMinor }, [{ method: 'cash', amountMinor: tot.computedTotalMinor }]);
}

describe('scanned invoice: unknown lines become new products on confirm', () => {
  it('creates the products (unit from the invoice, new unit «كيس» created, markup + rounding, review mark) and posts the purchase', async () => {
    const unitsBefore = (await listUnits(db)).length;
    const r = await postScan();
    expect(r.totalMinor).toBe(57_680);

    const tissues = (await byName('مناديل فاين'))!;
    expect(tissues).toMatchObject({ costMinor: 12_340, retailPriceMinor: 14_850, needsPriceReview: true });
    expect((await getProduct(db, tissues.id))!.baseUnit.nameAr).toBe('كرتونة');
    expect(await stock(tissues.id)).toBe(2000);

    const sugar = (await byName('سكر ابيض'))!;
    expect(sugar).toMatchObject({ costMinor: 3000, retailPriceMinor: 3600, needsPriceReview: true });
    const bag = (await db.select().from(units).where(eq(units.nameAr, 'كيس')))[0]!;
    expect(bag).toMatchObject({ nameEn: 'Bag', allowsFraction: false });
    expect((await getProduct(db, sugar.id))!.baseUnit.id).toBe(bag.id);
    expect((await listUnits(db)).length).toBe(unitsBefore + 1);

    // The known product was matched, not duplicated.
    expect(await stock(tea)).toBe(10_000);
    expect((await db.select().from(products).where(eq(products.name, 'شاي العروسة'))).length).toBe(1);
    expect(await countNeedsPriceReview(db)).toBe(2);
    expect(await checkStockLevels(db)).toEqual([]);
    expect([...(await trialBalance(db)).values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
  });

  it('a failed posting rolls the new products and units back', async () => {
    const review = buildReview(INVOICE.lines, await shopProducts(), { autoCreate: true, pricing });
    const lines = await scanPurchaseLines(db, ctx, review);
    // A line pointing at a product that does not exist makes the posting fail AFTER the new products were inserted.
    const broken = [...lines, { ...lines[0]!, key: 'x', productId: 'missing', productUnitId: 'missing' }];
    const before = (await listProducts(db, { limit: 100 })).length;
    await expect(postPurchase(ctx, { lines: broken, pricesIncludeVat: true }, [{ method: 'cash', amountMinor: 100_000 }])).rejects.toThrow();
    expect((await listProducts(db, { limit: 100 })).length).toBe(before);
    expect(await byName('مناديل فاين')).toBeUndefined();
    expect((await db.select().from(units).where(eq(units.nameAr, 'كيس'))).length).toBe(0);
    expect(await stock(tea)).toBe(0);
  });

  it('plan limit: refuses the whole invoice and says how many fit', async () => {
    setLicenceState(lic(2)); // 1 product now → 1 more fits, the invoice needs 2
    const e = await postScan().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ProductLimitError);
    expect(e).toMatchObject({ fits: 1, wanted: 2, reason: 'limit', limit: 'products' });
    expect(await byName('مناديل فاين')).toBeUndefined();
    expect(await stock(tea)).toBe(0);
  });

  it('the same new product twice on one invoice is created once', async () => {
    await postScan({ ...INVOICE, lines: [INVOICE.lines[2]!, { ...INVOICE.lines[2]!, qty: 1, total: 30 }], subtotal: 180, total: 180 });
    expect((await db.select().from(products).where(eq(products.name, 'سكر ابيض'))).length).toBe(1);
    expect(await stock((await byName('سكر ابيض'))!.id)).toBe(6000);
  });
});

describe('quick add with opening stock (photographed list / scan-and-add)', () => {
  it('list: new products + existing ones go in with ONE opening document; missing cost → review', async () => {
    const r = await quickAddStock(
      ctx,
      [
        { create: { name: 'صابون لوكس', unit: 'قطعه', costMinor: 1200, retailPriceMinor: 1500, needsPriceReview: false }, qtyMilli: 12_000 },
        { create: { name: 'رز الضحى', unit: 'كجم', costMinor: 0, retailPriceMinor: 0, needsPriceReview: true }, qtyMilli: 7_500 },
        { productId: tea, productUnitId: (await getProduct(db, tea))!.units.find((u) => !u.isBase)!.id, qtyMilli: 2000, costMinor: 43_200 },
      ],
      { source: 'list_scan' },
    );
    expect(r.created).toBe(2);
    const docs = await db.select().from(inventoryDocs).where(eq(inventoryDocs.type, 'OPENING'));
    expect(docs.filter((d) => d.id === r.openingDocId)).toHaveLength(1);
    expect(await stock(tea)).toBe(48_000); // 2 cartons × 24
    const soap = (await byName('صابون لوكس'))!;
    expect(soap).toMatchObject({ retailPriceMinor: 1500, needsPriceReview: false });
    expect(await stock(soap.id)).toBe(12_000);
    const rice = (await byName('رز الضحى'))!;
    expect(rice).toMatchObject({ costMinor: 0, retailPriceMinor: 0, needsPriceReview: true });
    expect((await getProduct(db, rice.id))!.baseUnit.nameAr).toBe('كيلو');
    expect(await stock(rice.id)).toBe(7500);
    expect(await countNeedsPriceReview(db)).toBe(1);
    expect((await listProducts(db, { needsPriceReviewOnly: true })).map((p) => p.name)).toEqual(['رز الضحى']);
    expect(await checkStockLevels(db)).toEqual([]);
    expect([...(await trialBalance(db)).values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('list scan end to end: review rows → products + opening stock in one go', async () => {
    const rows = buildListReview(
      [
        { name: 'شاي العروسة', qty: 2, unit: 'كرتونة', cost: null, price: null },
        { name: 'زيت عافية', qty: 6, unit: 'ازازة', cost: 60, price: 75 },
        { name: 'ملح', qty: 4, unit: null, cost: null, price: null },
      ],
      await shopProducts(),
      { autoCreate: true, pricing },
    );
    const items = listToStockItems([rows[0]!, rows[1]!, { ...rows[2]!, priceLater: true }]);
    const r = await quickAddStock(ctx, items, { source: 'list_scan' });
    expect(r.created).toBe(2);
    expect(await stock(tea)).toBe(48_000); // existing: «2 كرتونة» = 2 × 24 pieces (the product's carton unit)
    const oil = (await byName('زيت عافية'))!;
    expect(oil).toMatchObject({ costMinor: 6000, retailPriceMinor: 7500, needsPriceReview: false });
    expect((await getProduct(db, oil.id))!.baseUnit.nameAr).toBe('زجاجة');
    expect(await byName('ملح')).toMatchObject({ retailPriceMinor: 0, needsPriceReview: true });
    expect(await checkStockLevels(db)).toEqual([]);
  });

  it('a sale price is required unless «سيب السعر بعدين» marks the product for review', async () => {
    await expect(quickAddStock(ctx, [{ create: { name: 'بلا سعر', unit: null, costMinor: 100, retailPriceMinor: 0, needsPriceReview: false }, qtyMilli: 1000 }])).rejects.toBeInstanceOf(InventoryError);
    expect(await byName('بلا سعر')).toBeUndefined();
  });

  it('list: plan limit counted for the batch, nothing created', async () => {
    setLicenceState(lic(2));
    const e = await quickAddStock(ctx, [
      { create: { name: 'أ', unit: null, costMinor: 0, retailPriceMinor: 100, needsPriceReview: false }, qtyMilli: 1000 },
      { create: { name: 'ب', unit: null, costMinor: 0, retailPriceMinor: 100, needsPriceReview: false }, qtyMilli: 1000 },
    ]).catch((x: unknown) => x);
    expect(e).toMatchObject({ fits: 1, wanted: 2 });
    expect((await listProducts(db, { limit: 100 })).length).toBe(1);
  });

  it('continuous scan-add: unknown barcode → product + stock; known barcodes pile up and post once; a taken barcode creates nothing', async () => {
    const a = await quickAddStock(ctx, [{ create: { name: 'بيبسي كانز', unit: 'علبة', costMinor: 800, retailPriceMinor: 1000, needsPriceReview: false, barcode: '6221234567890' }, qtyMilli: 24_000 }], { source: 'scan_add' });
    const hit = (await findByBarcode(db, '6221234567890'))!;
    expect(hit.productId).toBe(a.productIds[0]);
    expect(await stock(hit.productId)).toBe(24_000);
    // «خلّصت»: pending +1s of known codes (tea scanned 3×, pepsi 2×) post as one opening document.
    const r = await quickAddStock(ctx, [{ productId: tea, qtyMilli: 3000 }, { productId: hit.productId, qtyMilli: 2000 }], { source: 'scan_add' });
    expect(r.created).toBe(0);
    expect(await stock(tea)).toBe(3000);
    expect(await stock(hit.productId)).toBe(26_000);
    await expect(quickAddStock(ctx, [{ create: { name: 'تاني', unit: null, costMinor: 0, retailPriceMinor: 100, needsPriceReview: false, barcode: '111' }, qtyMilli: 1000 }])).rejects.toMatchObject({ code: 'barcode_taken' });
    expect(await byName('تاني')).toBeUndefined();
  });

  it('units: written words map to the standard units; unknown words fall back to قطعة', async () => {
    const cache = new Map<string, string>();
    const carton = (await listUnits(db)).find((u) => u.nameAr === 'كرتونة')!.id;
    expect(await resolveUnitId(db, ctx, 'كرتونه', cache)).toBe(carton);
    expect(await resolveUnitId(db, ctx, 'CTN', cache)).toBe(carton);
    expect(await resolveUnitId(db, ctx, 'حاجة غريبة', cache)).toBe(piece);
    expect(await resolveUnitId(db, ctx, null, cache)).toBe(piece);
  });
});

describe('price review', () => {
  it('confirming a sale price (or saving the form with one) clears the mark', async () => {
    await quickAddStock(ctx, [
      { create: { name: 'رز', unit: null, costMinor: 0, retailPriceMinor: 0, needsPriceReview: true }, qtyMilli: 0 },
      { create: { name: 'فول', unit: null, costMinor: 500, retailPriceMinor: 600, needsPriceReview: true }, qtyMilli: 0 },
    ]);
    expect(await countNeedsPriceReview(db)).toBe(2);
    const rice = (await byName('رز'))!;
    await expect(confirmSalePrice(ctx, rice.id, 0)).rejects.toBeInstanceOf(InventoryError);
    await confirmSalePrice(ctx, rice.id, 2500);
    expect(await byName('رز')).toMatchObject({ retailPriceMinor: 2500, wholesalePriceMinor: 2500, needsPriceReview: false });
    const beans = (await byName('فول'))!;
    await updateProduct(ctx, beans.id, { name: 'فول', baseUnitId: beans.baseUnitId, costMinor: 500, retailPriceMinor: 700, wholesalePriceMinor: 650, trackStock: true, trackExpiry: false, barcodes: [] });
    expect(await countNeedsPriceReview(db)).toBe(0);
  });
});
