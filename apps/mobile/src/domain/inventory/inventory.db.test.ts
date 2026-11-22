import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { DEFAULT_PLANS, SYSTEM_ROLES, guessMapping, validateImportRows, type LicenceState, type ImportRow } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { auditLog, inventoryDocs, stockLevels, stockMovements } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { verifyAuditRows } from '../audit/audit';
import { withTx } from '../../db/tx';
import { ensureInventorySeed } from './seed';
import type { InvCtx } from './context';
import { InventoryError } from './context';
import { addVariant, bulkChangePrices, createProduct, deleteProduct, findByBarcode, getProduct, inventorySummary, listProducts, restoreProduct, updateProduct, type ProductInput } from './products';
import { checkStockLevels, defaultWarehouseId, postMovements, rebuildStockLevels } from './ledger';
import { countItem, countLines, openCount, postAdjustment, postCount } from './adjust';
import { defaultUnitId, listUnits, saveCategory } from './catalog';
import { exportProductRows, importProducts } from './import';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const free = DEFAULT_PLANS.find((p) => p.code === 'free')!;
const owner = SYSTEM_ROLES[0]!;
const cashier = SYSTEM_ROLES[2]!;

function licence(plan = pro, canWrite = true): LicenceState {
  return { mode: canWrite ? 'full' : 'read_only', reason: 'ok', plan: plan.code, limits: plan.limits, features: plan.features, canWrite, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
}

function user(role = owner, id = 'u-owner'): SessionUser {
  return { id, name: 'Owner', color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false };
}

let db: Db;
let ctx: InvCtx;
let clock: number;
let piece: string;
let carton: string;

beforeEach(async () => {
  db = createTestDb();
  clock = 1_800_000_000_000;
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(licence());
  ctx = { db, user: user(), device: { id: 'dev-1', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn', features: pro.features, now: () => (clock += 1000) };
  const us = await listUnits(db);
  piece = us.find((u) => u.nameAr === 'قطعة')!.id;
  carton = us.find((u) => u.nameAr === 'كرتونة')!.id;
});

const input = (over: Partial<ProductInput> = {}): ProductInput => ({
  name: 'شاي العروسة',
  baseUnitId: piece,
  costMinor: 1850,
  retailPriceMinor: 2200,
  wholesalePriceMinor: 2000,
  trackStock: true,
  trackExpiry: false,
  lowStockMilli: 12_000,
  barcodes: ['6221234567890'],
  ...over,
});

describe('products', () => {
  it('creates a product with units, barcodes, opening stock and search', async () => {
    const id = await createProduct(ctx, { ...input({ largerUnit: { unitId: carton, factorMilli: 24_000, retailPriceMinor: 50_000, wholesalePriceMinor: null, barcode: '16221234567897' } }), openingQtyMilli: 48_000 });
    const d = (await getProduct(db, id))!;
    expect(d.level).toEqual({ qtyMilli: 48_000, avgCostMinor: 1850, valueMinor: 88_800 });
    expect(d.units).toHaveLength(2);
    expect(d.barcodes.map((b) => b.code).sort()).toEqual(['16221234567897', '6221234567890']);
    const doc = (await db.select().from(inventoryDocs))[0]!;
    expect(doc).toMatchObject({ type: 'OPENING', status: 'POSTED', number: 'STK-A-000001' });
    // scanning the carton barcode returns the carton unit
    expect(await findByBarcode(db, '١٦٢٢١٢٣٤٥٦٧٨٩٧')).toMatchObject({ productId: id, factorMilli: 24_000 });
    // Arabic-normalised search: "العروسه" (ه) finds "العروسة" (ة); prefix search; barcode search
    expect((await listProducts(db, { search: 'العروسه' })).map((p) => p.id)).toEqual([id]);
    expect((await listProducts(db, { search: 'شا' })).map((p) => p.id)).toEqual([id]);
    expect((await listProducts(db, { search: '6221234567890' })).map((p) => p.id)).toEqual([id]);
    expect(await listProducts(db, { search: 'قهوة' })).toEqual([]);
  });

  it('keeps barcodes unique among live products; delete releases, undo restores', async () => {
    const a = await createProduct(ctx, input());
    await expect(createProduct(ctx, input({ name: 'آخر' }))).rejects.toMatchObject({ code: 'barcode_taken' });
    await deleteProduct(ctx, a);
    expect(await listProducts(db)).toEqual([]);
    const b = await createProduct(ctx, input({ name: 'منتج جديد' }));
    await expect(restoreProduct(ctx, a)).rejects.toMatchObject({ code: 'barcode_taken' });
    await deleteProduct(ctx, b);
    await restoreProduct(ctx, a);
    expect((await listProducts(db)).map((p) => p.id)).toEqual([a]);
    expect(await findByBarcode(db, '6221234567890')).toMatchObject({ productId: a });
  });

  it('cashier cannot create products or change prices; manager price change is audited', async () => {
    await expect(createProduct({ ...ctx, user: user(cashier, 'u-c') }, input())).rejects.toThrow('missing permission');
    const id = await createProduct(ctx, input());
    await updateProduct(ctx, id, input({ retailPriceMinor: 2500 }));
    const audit = await db.select().from(auditLog).orderBy(asc(auditLog.seq));
    expect(audit.map((a) => a.action)).toEqual(['product.create', 'product.price_change']);
    expect(JSON.parse(audit[1]!.beforeJson!)).toMatchObject({ retail: 2200 });
    expect(verifyAuditRows(audit).ok).toBe(true);
  });

  it('read-only licence blocks writes; free plan limit blocks the 101st product', async () => {
    setLicenceState(licence(pro, false));
    await expect(createProduct(ctx, input())).rejects.toThrow();
    setLicenceState(licence(free));
    const freeCtx = { ...ctx, features: free.features };
    for (let i = 0; i < free.limits.products; i++) await createProduct(freeCtx, input({ name: `p${i}`, barcodes: [] }));
    await expect(createProduct(freeCtx, input({ name: 'one more', barcodes: [] }))).rejects.toMatchObject({ reason: 'limit' });
  });

  it('larger units need the multi_unit feature', async () => {
    await expect(createProduct({ ...ctx, features: [] }, input({ largerUnit: { unitId: carton, factorMilli: 24_000, retailPriceMinor: null, wholesalePriceMinor: null, barcode: null } }))).rejects.toMatchObject({ code: 'feature_unavailable' });
  });

  it('variants share a group and have their own stock', async () => {
    const a = await createProduct(ctx, { ...input({ name: 'تيشيرت', barcodes: [] }), openingQtyMilli: 5000 });
    const b = await addVariant(ctx, a, 'XL', 'M');
    const d = (await getProduct(db, b))!;
    expect(d.variants.map((v) => v.variantLabel)).toEqual(['M', 'XL']);
    expect(d.level.qtyMilli).toBe(0);
  });

  it('bulk price change +10% rounded to 0.50', async () => {
    const a = await createProduct(ctx, input({ barcodes: [] }));
    const b = await createProduct(ctx, input({ name: 'زيت', barcodes: [], retailPriceMinor: 4599 }));
    expect(await bulkChangePrices(ctx, [a, b], { bp: 1000, field: 'retail', roundTo: 50 })).toBe(2);
    expect((await getProduct(db, a))!.product.retailPriceMinor).toBe(2400); // 22.00 → 24.20 → 24.00
    expect((await getProduct(db, b))!.product.retailPriceMinor).toBe(5050); // 45.99 → 50.59 → 50.50
    expect((await getProduct(db, a))!.product.wholesalePriceMinor).toBe(2000); // untouched
  });

  it('keyset pagination returns every product exactly once, in order', async () => {
    const cat = await saveCategory(ctx, { name: 'مشروبات' });
    for (let i = 0; i < 37; i++) await createProduct(ctx, input({ name: `منتج ${String(i).padStart(2, '0')}`, barcodes: [], categoryId: i % 2 ? cat : null }));
    const seen: string[] = [];
    let after: { name: string; id: string } | null = null;
    for (;;) {
      const page = await listProducts(db, { limit: 10, after });
      if (!page.length) break;
      seen.push(...page.map((p) => p.id));
      after = { name: page[page.length - 1]!.name, id: page[page.length - 1]!.id };
    }
    expect(seen).toHaveLength(37);
    expect(new Set(seen).size).toBe(37);
    expect(await listProducts(db, { categoryId: cat, limit: 100 })).toHaveLength(18);
  });
});

describe('stock ledger', () => {
  it('stock_movements and posted documents cannot be edited or deleted', async () => {
    await createProduct(ctx, { ...input(), openingQtyMilli: 10_000 });
    // The driver may throw synchronously or reject; the SQLite message is in `cause`.
    const sqlError = async (q: ReturnType<typeof sql>) => {
      try {
        await db.run(q);
        return 'no error';
      } catch (e) {
        return String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message);
      }
    };
    expect(await sqlError(sql`UPDATE stock_movements SET qty_milli = 999`)).toMatch(/append-only/);
    expect(await sqlError(sql`DELETE FROM stock_movements`)).toMatch(/append-only/);
    expect(await sqlError(sql`UPDATE inventory_docs SET note = 'x'`)).toMatch(/immutable/);
    expect(await sqlError(sql`UPDATE inventory_lines SET delta_milli = 1`)).toMatch(/immutable/);
    expect(await sqlError(sql`DELETE FROM inventory_docs`)).toMatch(/immutable/);
  });

  it('adjustments follow the negative-stock policy', async () => {
    const id = await createProduct(ctx, { ...input(), openingQtyMilli: 3_000 });
    await postAdjustment(ctx, { productId: id, deltaMilli: -5_000, reason: 'damaged' }); // warn → allowed
    expect((await getProduct(db, id))!.level.qtyMilli).toBe(-2_000);
    await expect(postAdjustment({ ...ctx, negativeStock: 'block' }, { productId: id, deltaMilli: -1_000, reason: 'lost' })).rejects.toMatchObject({ code: 'negative_blocked' });
    expect((await getProduct(db, id))!.level.qtyMilli).toBe(-2_000); // rolled back
    expect(await db.select().from(stockMovements)).toHaveLength(2);
  });

  it('stock count: scanned products become exactly the counted quantity; others unchanged', async () => {
    const a = await createProduct(ctx, { ...input(), openingQtyMilli: 10_000 });
    const b = await createProduct(ctx, { ...input({ name: 'زيت', barcodes: ['111'] }), openingQtyMilli: 7_000 });
    const doc = await openCount(ctx);
    await countItem(ctx, doc, a, 1000);
    await countItem(ctx, doc, a, 1000);
    await countItem(ctx, doc, a, 6000);
    expect((await countLines(db, doc))[0]).toMatchObject({ productId: a, countedMilli: 8000, expectedMilli: 10_000 });
    expect(await openCount(ctx)).toBe(doc); // one open count at a time
    const r = await postCount(ctx, doc);
    expect(r.changed).toBe(1);
    expect((await getProduct(db, a))!.level.qtyMilli).toBe(8000);
    expect((await getProduct(db, b))!.level.qtyMilli).toBe(7000);
  });

  it('PROPERTY: after any sequence of operations, rebuilding from the ledger equals the cache', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push(await createProduct(ctx, { ...input({ name: `p${i}`, barcodes: [], costMinor: 100 * (i + 1) }), openingQtyMilli: i % 2 ? 5_000 : 0 }));
    const wh = await defaultWarehouseId(db);
    const op = fc.record({
      kind: fc.constantFrom('purchase', 'sale', 'adjust', 'count', 'return'),
      p: fc.integer({ min: 0, max: 3 }),
      qty: fc.integer({ min: 1, max: 20_000 }),
      cost: fc.integer({ min: 0, max: 50_000 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 25 }), async (ops) => {
        for (const o of ops) {
          const productId = ids[o.p]!;
          if (o.kind === 'adjust') await postAdjustment(ctx, { productId, deltaMilli: o.qty % 2 ? o.qty : -o.qty, reason: 'correction' });
          else if (o.kind === 'count') {
            const doc = await openCount(ctx);
            await countItem(ctx, doc, productId, o.qty, 'set');
            await postCount(ctx, doc);
          } else {
            // purchases / sales / returns arrive in Phase 3–4; exercise the ledger directly with their types
            await withTx(db, (tx) =>
              postMovements(tx, ctx, wh, [
                o.kind === 'purchase'
                  ? { productId, qtyMilli: o.qty, type: 'PURCHASE', unitCostMinor: o.cost, sourceType: 'test', sourceId: 't' }
                  : o.kind === 'return'
                    ? { productId, qtyMilli: o.qty, type: 'SALE_RETURN', unitCostMinor: o.cost, sourceType: 'test', sourceId: 't' }
                    : { productId, qtyMilli: -o.qty, type: 'SALE', sourceType: 'test', sourceId: 't' },
              ]),
            );
          }
        }
        expect(await checkStockLevels(db)).toEqual([]);
      }),
      { numRuns: 25 },
    );
    const before = await db.select().from(stockLevels);
    expect(await rebuildStockLevels(db)).toEqual([]);
    const after = await db.select().from(stockLevels);
    const key = (r: typeof stockLevels.$inferSelect) => `${r.productId}:${r.qtyMilli}:${r.avgCostMinor}:${r.valueMinor}`;
    expect(after.map(key).sort()).toEqual(before.map(key).sort());
    // qty in cache == plain sum of the ledger
    const sums = await db.all<{ product_id: string; q: number }>(sql`SELECT product_id, sum(qty_milli) q FROM stock_movements GROUP BY product_id`);
    for (const s of sums) expect(after.find((a) => a.productId === s.product_id)!.qtyMilli).toBe(Number(s.q));
  });

  it('rebuild repairs a corrupted cache and reports the difference', async () => {
    const id = await createProduct(ctx, { ...input(), openingQtyMilli: 10_000 });
    await db.update(stockLevels).set({ qtyMilli: 1 }).where(eq(stockLevels.productId, id));
    const diffs = await rebuildStockLevels(db);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.ledger.qtyMilli).toBe(10_000);
    expect((await getProduct(db, id))!.level.qtyMilli).toBe(10_000);
  });

  it('summary: products, low stock, out of stock, value', async () => {
    await createProduct(ctx, { ...input(), openingQtyMilli: 100_000 });
    await createProduct(ctx, { ...input({ name: 'قليل', barcodes: [] }), openingQtyMilli: 5_000 });
    await createProduct(ctx, input({ name: 'خلصان', barcodes: [] }));
    expect(await inventorySummary(db)).toEqual({ products: 3, lowStock: 2, outOfStock: 1, stockValueMinor: 100 * 1850 + 5 * 1850 });
    expect((await listProducts(db, { lowStockOnly: true })).map((p) => p.name).sort()).toEqual(['خلصان', 'قليل']);
  });
});

describe('Excel import / export', () => {
  function rows(n: number, offset = 0): ImportRow[] {
    return Array.from({ length: n }, (_, i) => ({
      rowNumber: i + 2,
      name: `صنف رقم ${i + offset}`,
      barcode: String(6_220_000_000_000 + i + offset),
      sku: `SKU-${i + offset}`,
      category: ['مشروبات', 'منظفات', 'ألبان', 'معلبات'][i % 4]!,
      unit: i % 10 === 0 ? 'كيلو' : 'قطعة',
      costMinor: 1000 + (i % 500),
      retailMinor: 1500 + (i % 500),
      wholesaleMinor: 1300 + (i % 500),
      qtyMilli: (i % 50) * 1000,
      lowStockMilli: 5000,
      largerUnit: i % 3 === 0 ? 'كرتونة' : null,
      largerFactorMilli: i % 3 === 0 ? 12_000 : null,
      largerPriceMinor: i % 3 === 0 ? 17_000 : null,
      largerBarcode: null,
    }));
  }

  it('imports 5,000 products with stock in one go (timing logged)', async () => {
    let progressCalls = 0;
    const r = await importProducts(ctx, rows(5000), { updateExisting: false }, () => progressCalls++);
    console.log(`import 5000 products: ${r.ms} ms (Node + better-sqlite3; phone timing must be measured on device)`);
    expect(r).toMatchObject({ created: 5000, updated: 0, skippedExisting: 0, failed: [] });
    expect(progressCalls).toBe(20);
    expect((await inventorySummary(db)).products).toBe(5000);
    expect(await checkStockLevels(db)).toEqual([]);
    expect((await listProducts(db, { search: 'رقم 4321' })).map((p) => p.name)).toContain('صنف رقم 4321');
    expect(await findByBarcode(db, String(6_220_000_000_000 + 4999))).not.toBeNull();
    expect(r.ms).toBeLessThan(30_000);
  });

  it('re-import updates existing products (matched by barcode) or skips them', async () => {
    await importProducts(ctx, rows(10), { updateExisting: false });
    const changed = rows(10).map((r) => ({ ...r, retailMinor: 9999 }));
    expect(await importProducts(ctx, changed, { updateExisting: false })).toMatchObject({ created: 0, skippedExisting: 10 });
    expect(await importProducts(ctx, changed, { updateExisting: true })).toMatchObject({ created: 0, updated: 10 });
    expect((await listProducts(db, { limit: 100 })).every((p) => p.retailPriceMinor === 9999)).toBe(true);
  });

  it('stops at the plan limit and reports the rows that did not fit', async () => {
    setLicenceState(licence(free));
    const r = await importProducts({ ...ctx, features: free.features }, rows(120).map((x) => ({ ...x, largerUnit: null, largerFactorMilli: null })), { updateExisting: false });
    expect(r.created).toBe(100);
    expect(r.failed.filter((f) => f.code === 'limit')).toHaveLength(20);
  });

  it('export → validate → import round-trips', async () => {
    await importProducts(ctx, rows(30), { updateExisting: false });
    const sheet = await exportProductRows(db, true);
    const v = validateImportRows(sheet.slice(1), guessMapping(sheet[0]!));
    expect(v.errors).toEqual([]);
    expect(v.valid).toHaveLength(30);
    const fresh = createTestDb();
    await ensureInventorySeed(fresh, ctx.device, clock);
    const r = await importProducts({ ...ctx, db: fresh }, v.valid, { updateExisting: false });
    expect(r.created).toBe(30);
    expect((await inventorySummary(fresh)).stockValueMinor).toBe((await inventorySummary(db)).stockValueMinor);
  });

  it('default unit exists', async () => {
    expect(await defaultUnitId(db)).toBe(piece);
  });
});

describe('error types', () => {
  it('InventoryError carries a code', () => {
    expect(new InventoryError('barcode_taken').code).toBe('barcode_taken');
  });
});
