/**
 * Products: create / edit / soft delete + undo / variants / bulk edit / queries.
 * All writes: permission check → licence guard → one transaction → audit entry.
 */
import { and, asc, count, desc, eq, gt, inArray, isNull, lte, or, sql, sum } from 'drizzle-orm';
import { applyBp, businessDay, divRound, HybridLogicalClock, normalizeBarcode, uuidv7 } from '@daftarak/shared';
import { barcodes, categories, inventoryDocs, inventoryLines, productGroups, productUnits, products, stockLevels, stockMovements, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite, assertWithinLimit } from '../licence/guard';
import { InventoryError, nowOf, type InvCtx } from './context';
import { defaultWarehouseId, postMovements } from './ledger';
import { nextDocNumber } from './numbering';
import { refreshProductSearch, ftsQuery, insertProductSearch } from './search';

export interface LargerUnitInput {
  unitId: string;
  factorMilli: number;
  retailPriceMinor: number | null;
  wholesalePriceMinor: number | null;
  barcode: string | null;
}

export interface ProductInput {
  name: string;
  nameEn?: string | null;
  sku?: string | null;
  categoryId?: string | null;
  baseUnitId: string;
  costMinor: number;
  retailPriceMinor: number;
  wholesalePriceMinor: number;
  taxRateBp?: number | null;
  trackStock: boolean;
  trackExpiry: boolean;
  lowStockMilli?: number | null;
  imagePath?: string | null;
  notes?: string | null;
  barcodes: string[];
  largerUnit?: LargerUnitInput | null;
  groupId?: string | null;
  variantLabel?: string | null;
}

let hlc: HybridLogicalClock | null = null;
const tick = (ctx: InvCtx) => (hlc ??= new HybridLogicalClock(ctx.device.code)).tick();

function validate(input: ProductInput, ctx: InvCtx) {
  if (!input.name.trim()) throw new InventoryError('name_required');
  for (const v of [input.costMinor, input.retailPriceMinor, input.wholesalePriceMinor]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new InventoryError('invalid_price');
  }
  if (input.lowStockMilli != null && (!Number.isSafeInteger(input.lowStockMilli) || input.lowStockMilli < 0)) throw new InventoryError('invalid_qty');
  if (input.largerUnit) {
    if (!ctx.features.includes('multi_unit')) throw new InventoryError('feature_unavailable', { feature: 'multi_unit' });
    if (!Number.isSafeInteger(input.largerUnit.factorMilli) || input.largerUnit.factorMilli <= 1000) throw new InventoryError('invalid_qty');
  }
  if (input.trackExpiry && !ctx.features.includes('expiry')) throw new InventoryError('feature_unavailable', { feature: 'expiry' });
}

function cleanCodes(list: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const c of list) {
    const n = c ? normalizeBarcode(c) : '';
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Throws barcode_taken if any code belongs to another live product. */
async function assertCodesFree(tx: Db, codes: string[], exceptProductId?: string) {
  if (!codes.length) return;
  const taken = await tx
    .select({ code: barcodes.code, productId: barcodes.productId, name: products.name })
    .from(barcodes)
    .innerJoin(products, eq(products.id, barcodes.productId))
    .where(and(inArray(barcodes.code, codes), isNull(barcodes.deletedAt)));
  const clash = taken.find((t) => t.productId !== exceptProductId);
  if (clash) throw new InventoryError('barcode_taken', { code: clash.code, productName: clash.name });
}

async function assertSkuFree(tx: Db, sku: string | null | undefined, exceptProductId?: string) {
  if (!sku) return;
  const r = await tx.select({ id: products.id }).from(products).where(and(eq(products.sku, sku), isNull(products.deletedAt))).limit(1);
  if (r[0] && r[0].id !== exceptProductId) throw new InventoryError('sku_taken', { sku });
}

export async function liveProductCount(db: Db): Promise<number> {
  return (await db.select({ n: count() }).from(products).where(isNull(products.deletedAt)))[0]?.n ?? 0;
}

/** Insert product rows (no permission/limit checks, no transaction) — shared by create and import. */
export async function insertProductRows(tx: Db, ctx: InvCtx, input: ProductInput, now: number): Promise<{ productId: string; baseUnitRowId: string }> {
  const productId = uuidv7(now);
  const base = { createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id };
  await tx.insert(products).values({
    id: productId,
    ...base,
    hlc: tick(ctx),
    name: input.name.trim(),
    nameEn: input.nameEn?.trim() || null,
    sku: input.sku?.trim() || null,
    categoryId: input.categoryId ?? null,
    groupId: input.groupId ?? null,
    variantLabel: input.variantLabel?.trim() || null,
    baseUnitId: input.baseUnitId,
    costMinor: input.costMinor,
    retailPriceMinor: input.retailPriceMinor,
    wholesalePriceMinor: input.wholesalePriceMinor,
    taxRateBp: input.taxRateBp ?? null,
    trackStock: input.trackStock,
    trackExpiry: input.trackExpiry,
    lowStockMilli: input.lowStockMilli ?? null,
    imagePath: input.imagePath ?? null,
    notes: input.notes ?? null,
  });
  const baseUnitRowId = uuidv7(now);
  await tx.insert(productUnits).values({ id: baseUnitRowId, ...base, productId, unitId: input.baseUnitId, factorMilli: 1000, isBase: true });
  const allCodes: string[] = [];
  for (const code of cleanCodes(input.barcodes)) {
    allCodes.push(code);
    await tx.insert(barcodes).values({ id: uuidv7(now), ...base, code, productId, productUnitId: baseUnitRowId });
  }
  if (input.largerUnit) {
    const lu = input.largerUnit;
    const luId = uuidv7(now);
    await tx.insert(productUnits).values({ id: luId, ...base, productId, unitId: lu.unitId, factorMilli: lu.factorMilli, retailPriceMinor: lu.retailPriceMinor, wholesalePriceMinor: lu.wholesalePriceMinor, isBase: false });
    const code = cleanCodes([lu.barcode])[0];
    if (code) {
      allCodes.push(code);
      await tx.insert(barcodes).values({ id: uuidv7(now), ...base, code, productId, productUnitId: luId });
    }
  }
  await insertProductSearch(tx, productId, [input.name, input.nameEn, input.sku, input.variantLabel], allCodes);
  return { productId, baseUnitRowId };
}

/** Opening stock as a posted OPENING document (one per product create, or one per import). */
export async function postOpeningStock(tx: Db, ctx: InvCtx, lines: { productId: string; qtyMilli: number; unitCostMinor: number }[], now: number, note?: string): Promise<string | null> {
  const real = lines.filter((l) => l.qtyMilli !== 0);
  if (!real.length) return null;
  const warehouseId = await defaultWarehouseId(tx);
  const docId = uuidv7(now);
  const base = { createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id };
  await tx.insert(inventoryDocs).values({ id: docId, ...base, type: 'OPENING', status: 'DRAFT', warehouseId, note: note ?? null });
  for (const l of real) {
    const lineId = uuidv7(now);
    await tx.insert(inventoryLines).values({ id: lineId, ...base, docId, productId: l.productId, deltaMilli: l.qtyMilli, unitCostMinor: l.unitCostMinor });
    await postMovements(tx, ctx, warehouseId, [{ productId: l.productId, qtyMilli: l.qtyMilli, type: 'OPENING', unitCostMinor: l.unitCostMinor, sourceType: 'inventory_doc', sourceId: docId, sourceLineId: lineId }]);
  }
  const number = await nextDocNumber(tx, ctx.device, 'INVENTORY', 'STK');
  await tx.update(inventoryDocs).set({ status: 'POSTED', number, postedAt: now, businessDay: businessDay(now, ctx.timezone), updatedAt: now }).where(eq(inventoryDocs.id, docId));
  return docId;
}

export async function createProduct(ctx: InvCtx, input: ProductInput & { openingQtyMilli?: number | null }): Promise<string> {
  requirePermission(ctx.user, 'products.manage');
  assertWithinLimit('products', await liveProductCount(ctx.db));
  validate(input, ctx);
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    await assertCodesFree(tx, cleanCodes([...input.barcodes, input.largerUnit?.barcode]));
    await assertSkuFree(tx, input.sku);
    const { productId } = await insertProductRows(tx, ctx, input, now);
    if (input.openingQtyMilli && input.trackStock) await postOpeningStock(tx, ctx, [{ productId, qtyMilli: input.openingQtyMilli, unitCostMinor: input.costMinor }], now);
    await appendAudit(tx, {
      action: 'product.create',
      entity: 'products',
      entityId: productId,
      after: { name: input.name, cost: input.costMinor, retail: input.retailPriceMinor, wholesale: input.wholesalePriceMinor, opening: input.openingQtyMilli ?? 0 },
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: now,
    });
    return productId;
  });
}

export async function updateProduct(ctx: InvCtx, productId: string, input: ProductInput): Promise<void> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  validate(input, ctx);
  const now = nowOf(ctx);
  await withTx(ctx.db, async (tx) => {
    const before = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!before || before.deletedAt) throw new InventoryError('not_found');
    const priceChanged = before.retailPriceMinor !== input.retailPriceMinor || before.wholesalePriceMinor !== input.wholesalePriceMinor;
    if (priceChanged) requirePermission(ctx.user, 'price.change');
    if (before.costMinor !== input.costMinor) requirePermission(ctx.user, 'cost.view');
    const codes = cleanCodes(input.barcodes);
    await assertCodesFree(tx, cleanCodes([...codes, input.largerUnit?.barcode]), productId);
    await assertSkuFree(tx, input.sku, productId);
    await tx
      .update(products)
      .set({
        name: input.name.trim(),
        nameEn: input.nameEn?.trim() || null,
        sku: input.sku?.trim() || null,
        categoryId: input.categoryId ?? null,
        variantLabel: input.variantLabel?.trim() || null,
        baseUnitId: input.baseUnitId,
        costMinor: input.costMinor,
        retailPriceMinor: input.retailPriceMinor,
        wholesalePriceMinor: input.wholesalePriceMinor,
        taxRateBp: input.taxRateBp ?? null,
        trackStock: input.trackStock,
        trackExpiry: input.trackExpiry,
        lowStockMilli: input.lowStockMilli ?? null,
        imagePath: input.imagePath ?? null,
        notes: input.notes ?? null,
        updatedAt: now,
        hlc: tick(ctx),
      })
      .where(eq(products.id, productId));

    const unitRows = await tx.select().from(productUnits).where(and(eq(productUnits.productId, productId), isNull(productUnits.deletedAt)));
    const baseRow = unitRows.find((u) => u.isBase)!;
    await tx.update(productUnits).set({ unitId: input.baseUnitId, updatedAt: now }).where(eq(productUnits.id, baseRow.id));
    const larger = unitRows.find((u) => !u.isBase);
    const base = { createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id };

    // Barcodes: soft-delete the ones removed, add the new ones.
    const liveCodes = await tx.select().from(barcodes).where(and(eq(barcodes.productId, productId), isNull(barcodes.deletedAt)));
    const wanted = new Map<string, string>(); // code → product unit row id
    codes.forEach((c) => wanted.set(c, baseRow.id));
    let largerId = larger?.id ?? null;
    if (input.largerUnit) {
      const lu = input.largerUnit;
      if (larger) {
        await tx.update(productUnits).set({ unitId: lu.unitId, factorMilli: lu.factorMilli, retailPriceMinor: lu.retailPriceMinor, wholesalePriceMinor: lu.wholesalePriceMinor, updatedAt: now }).where(eq(productUnits.id, larger.id));
      } else {
        largerId = uuidv7(now);
        await tx.insert(productUnits).values({ id: largerId, ...base, productId, unitId: lu.unitId, factorMilli: lu.factorMilli, retailPriceMinor: lu.retailPriceMinor, wholesalePriceMinor: lu.wholesalePriceMinor, isBase: false });
      }
      const lc = cleanCodes([lu.barcode])[0];
      if (lc) wanted.set(lc, largerId!);
    } else if (larger) {
      await tx.update(productUnits).set({ deletedAt: now, updatedAt: now }).where(eq(productUnits.id, larger.id));
    }
    for (const b of liveCodes) {
      if (wanted.get(b.code) === b.productUnitId) wanted.delete(b.code);
      else await tx.update(barcodes).set({ deletedAt: now, updatedAt: now }).where(eq(barcodes.id, b.id));
    }
    for (const [code, unitRowId] of wanted) await tx.insert(barcodes).values({ id: uuidv7(now), ...base, code, productId, productUnitId: unitRowId });

    await refreshProductSearch(tx, productId);
    await appendAudit(tx, {
      action: priceChanged || before.costMinor !== input.costMinor ? 'product.price_change' : 'product.update',
      entity: 'products',
      entityId: productId,
      before: { name: before.name, cost: before.costMinor, retail: before.retailPriceMinor, wholesale: before.wholesalePriceMinor },
      after: { name: input.name, cost: input.costMinor, retail: input.retailPriceMinor, wholesale: input.wholesalePriceMinor },
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: now,
    });
  });
}

/** Soft delete (SPEC §4) — keeps history; barcodes are released so they can be reused. Undo with restoreProduct. */
export async function deleteProduct(ctx: InvCtx, productId: string): Promise<void> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  const now = nowOf(ctx);
  await withTx(ctx.db, async (tx) => {
    const p = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!p || p.deletedAt) throw new InventoryError('not_found');
    await tx.update(products).set({ deletedAt: now, updatedAt: now, hlc: tick(ctx) }).where(eq(products.id, productId));
    await tx.update(barcodes).set({ deletedAt: now, updatedAt: now }).where(and(eq(barcodes.productId, productId), isNull(barcodes.deletedAt)));
    await refreshProductSearch(tx, productId);
    await appendAudit(tx, { action: 'product.delete', entity: 'products', entityId: productId, before: { name: p.name }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
  });
}

export async function restoreProduct(ctx: InvCtx, productId: string): Promise<void> {
  requirePermission(ctx.user, 'products.manage');
  assertWithinLimit('products', await liveProductCount(ctx.db));
  const now = nowOf(ctx);
  await withTx(ctx.db, async (tx) => {
    const p = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!p || !p.deletedAt) throw new InventoryError('not_found');
    // Barcodes released at delete time (same timestamp) come back, unless someone took them meanwhile.
    const released = await tx.select().from(barcodes).where(and(eq(barcodes.productId, productId), eq(barcodes.deletedAt, p.deletedAt)));
    await assertCodesFree(tx, released.map((b) => b.code), productId);
    await assertSkuFree(tx, p.sku, productId);
    await tx.update(products).set({ deletedAt: null, updatedAt: now, hlc: tick(ctx) }).where(eq(products.id, productId));
    for (const b of released) await tx.update(barcodes).set({ deletedAt: null, updatedAt: now }).where(eq(barcodes.id, b.id));
    await refreshProductSearch(tx, productId);
    await appendAudit(tx, { action: 'product.restore', entity: 'products', entityId: productId, after: { name: p.name }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
  });
}

/** New variant (size/colour…) of a product: same group, own barcode/price/stock (D-06). */
export async function addVariant(ctx: InvCtx, productId: string, label: string, existingLabel?: string): Promise<string> {
  requirePermission(ctx.user, 'products.manage');
  assertWithinLimit('products', await liveProductCount(ctx.db));
  if (!label.trim()) throw new InventoryError('name_required');
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    const p = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
    if (!p || p.deletedAt) throw new InventoryError('not_found');
    let groupId = p.groupId;
    if (!groupId) {
      groupId = uuidv7(now);
      await tx.insert(productGroups).values({ id: groupId, name: p.name, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: tick(ctx) });
      await tx.update(products).set({ groupId, variantLabel: p.variantLabel ?? existingLabel ?? null, updatedAt: now, hlc: tick(ctx) }).where(eq(products.id, productId));
      await refreshProductSearch(tx, productId);
    }
    const { productId: id } = await insertProductRows(
      tx,
      ctx,
      {
        name: p.name,
        nameEn: p.nameEn,
        sku: null,
        categoryId: p.categoryId,
        baseUnitId: p.baseUnitId,
        costMinor: p.costMinor,
        retailPriceMinor: p.retailPriceMinor,
        wholesalePriceMinor: p.wholesalePriceMinor,
        taxRateBp: p.taxRateBp,
        trackStock: p.trackStock,
        trackExpiry: p.trackExpiry,
        lowStockMilli: p.lowStockMilli,
        imagePath: null,
        notes: null,
        barcodes: [],
        groupId,
        variantLabel: label,
      },
      now,
    );
    await appendAudit(tx, { action: 'product.create', entity: 'products', entityId: id, after: { name: p.name, variant: label, of: productId }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
    return id;
  });
}

/** Bulk price change by a percentage (basis points, may be negative) — with audit per product. */
export async function bulkChangePrices(ctx: InvCtx, ids: string[], opts: { bp: number; field: 'retail' | 'wholesale' | 'both'; roundTo?: number }): Promise<number> {
  requirePermission(ctx.user, 'products.manage');
  requirePermission(ctx.user, 'price.change');
  assertCanWrite();
  if (!Number.isSafeInteger(opts.bp) || opts.bp <= -10_000) throw new InventoryError('invalid_price');
  const now = nowOf(ctx);
  const step = opts.roundTo && opts.roundTo > 0 ? opts.roundTo : 1;
  const adj = (v: number) => divRound(v + applyBp(v, opts.bp), step) * step;
  return withTx(ctx.db, async (tx) => {
    const rows = await tx.select().from(products).where(and(inArray(products.id, ids), isNull(products.deletedAt)));
    for (const p of rows) {
      const retail = opts.field === 'wholesale' ? p.retailPriceMinor : adj(p.retailPriceMinor);
      const wholesale = opts.field === 'retail' ? p.wholesalePriceMinor : adj(p.wholesalePriceMinor);
      await tx.update(products).set({ retailPriceMinor: retail, wholesalePriceMinor: wholesale, updatedAt: now, hlc: tick(ctx) }).where(eq(products.id, p.id));
      const lus = await tx.select().from(productUnits).where(and(eq(productUnits.productId, p.id), eq(productUnits.isBase, false), isNull(productUnits.deletedAt)));
      for (const u of lus) {
        await tx
          .update(productUnits)
          .set({
            retailPriceMinor: u.retailPriceMinor != null && opts.field !== 'wholesale' ? adj(u.retailPriceMinor) : u.retailPriceMinor,
            wholesalePriceMinor: u.wholesalePriceMinor != null && opts.field !== 'retail' ? adj(u.wholesalePriceMinor) : u.wholesalePriceMinor,
            updatedAt: now,
          })
          .where(eq(productUnits.id, u.id));
      }
      await appendAudit(tx, {
        action: 'product.price_change',
        entity: 'products',
        entityId: p.id,
        before: { retail: p.retailPriceMinor, wholesale: p.wholesalePriceMinor },
        after: { retail, wholesale },
        reason: `bulk ${opts.bp / 100}%`,
        userId: ctx.user.id,
        deviceId: ctx.device.id,
        at: now,
      });
    }
    return rows.length;
  });
}

export async function bulkSetCategory(ctx: InvCtx, ids: string[], categoryId: string | null): Promise<number> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    const rows = await tx.select({ id: products.id, categoryId: products.categoryId }).from(products).where(and(inArray(products.id, ids), isNull(products.deletedAt)));
    for (const p of rows) await tx.update(products).set({ categoryId, updatedAt: now, hlc: tick(ctx) }).where(eq(products.id, p.id));
    await appendAudit(tx, { action: 'product.bulk_category', entity: 'products', after: { count: rows.length, categoryId }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
    return rows.length;
  });
}

// ─────────────────────────── queries ───────────────────────────

export interface ProductListRow {
  id: string;
  name: string;
  variantLabel: string | null;
  retailPriceMinor: number;
  costMinor: number;
  categoryId: string | null;
  trackStock: boolean;
  lowStockMilli: number | null;
  imagePath: string | null;
  qtyMilli: number;
  unitName: string;
}

export interface ListQuery {
  search?: string;
  categoryId?: string | null;
  lowStockOnly?: boolean;
  after?: { name: string; id: string } | null;
  limit?: number;
}

/** Keyset-paginated product list (never OFFSET) with FTS search and filters. */
export async function listProducts(db: Db, q: ListQuery = {}): Promise<ProductListRow[]> {
  const limit = q.limit ?? 50;
  const conds = [isNull(products.deletedAt)];
  if (q.categoryId) conds.push(eq(products.categoryId, q.categoryId));
  if (q.lowStockOnly) {
    conds.push(eq(products.trackStock, true));
    conds.push(sql`${products.lowStockMilli} IS NOT NULL AND coalesce(${stockLevels.qtyMilli}, 0) <= ${products.lowStockMilli}`);
  }
  if (q.search?.trim()) {
    const code = normalizeBarcode(q.search);
    const fts = ftsQuery(q.search);
    const viaCode = sql`${products.id} IN (SELECT product_id FROM barcodes WHERE code = ${code} AND deleted_at IS NULL)`;
    conds.push(fts ? sql`(${viaCode} OR ${products.id} IN (SELECT product_id FROM products_fts WHERE products_fts MATCH ${fts}))` : viaCode);
  }
  if (q.after) conds.push(or(gt(products.name, q.after.name), and(eq(products.name, q.after.name), gt(products.id, q.after.id)))!);
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      variantLabel: products.variantLabel,
      retailPriceMinor: products.retailPriceMinor,
      costMinor: products.costMinor,
      categoryId: products.categoryId,
      trackStock: products.trackStock,
      lowStockMilli: products.lowStockMilli,
      imagePath: products.imagePath,
      qtyMilli: sql<number>`coalesce(${stockLevels.qtyMilli}, 0)`,
      unitName: units.nameAr,
    })
    .from(products)
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
    .where(and(...conds))
    .orderBy(asc(products.name), asc(products.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, qtyMilli: Number(r.qtyMilli) }));
}

export interface ProductDetail {
  product: typeof products.$inferSelect;
  categoryName: string | null;
  baseUnit: typeof units.$inferSelect;
  units: (typeof productUnits.$inferSelect & { unit: typeof units.$inferSelect })[];
  barcodes: (typeof barcodes.$inferSelect)[];
  level: { qtyMilli: number; avgCostMinor: number; valueMinor: number };
  variants: { id: string; variantLabel: string | null; retailPriceMinor: number }[];
}

export async function getProduct(db: Db, productId: string): Promise<ProductDetail | null> {
  const p = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!p) return null;
  const cat = p.categoryId ? (await db.select({ name: categories.name }).from(categories).where(eq(categories.id, p.categoryId)).limit(1))[0] : undefined;
  const pus = await db.select().from(productUnits).innerJoin(units, eq(units.id, productUnits.unitId)).where(and(eq(productUnits.productId, productId), isNull(productUnits.deletedAt)));
  const codes = await db.select().from(barcodes).where(and(eq(barcodes.productId, productId), isNull(barcodes.deletedAt)));
  const lvl = (await db.select().from(stockLevels).where(eq(stockLevels.productId, productId)).limit(1))[0];
  const variants = p.groupId
    ? await db.select({ id: products.id, variantLabel: products.variantLabel, retailPriceMinor: products.retailPriceMinor }).from(products).where(and(eq(products.groupId, p.groupId), isNull(products.deletedAt))).orderBy(asc(products.createdAt))
    : [];
  const baseUnit = pus.find((u) => u.product_units.isBase)?.units ?? (await db.select().from(units).where(eq(units.id, p.baseUnitId)).limit(1))[0]!;
  return {
    product: p,
    categoryName: cat?.name ?? null,
    baseUnit,
    units: pus.map((u) => ({ ...u.product_units, unit: u.units })),
    barcodes: codes,
    level: lvl ? { qtyMilli: lvl.qtyMilli, avgCostMinor: lvl.avgCostMinor, valueMinor: lvl.valueMinor } : { qtyMilli: 0, avgCostMinor: 0, valueMinor: 0 },
    variants,
  };
}

/** Exact barcode lookup (scanner / hardware scanner). Returns the unit the code belongs to. */
export async function findByBarcode(db: Db, raw: string): Promise<{ productId: string; productUnitId: string; factorMilli: number } | null> {
  const code = normalizeBarcode(raw);
  if (!code) return null;
  const r = await db
    .select({ productId: barcodes.productId, productUnitId: barcodes.productUnitId, factorMilli: productUnits.factorMilli })
    .from(barcodes)
    .innerJoin(productUnits, eq(productUnits.id, barcodes.productUnitId))
    .innerJoin(products, eq(products.id, barcodes.productId))
    .where(and(eq(barcodes.code, code), isNull(barcodes.deletedAt), isNull(products.deletedAt)))
    .limit(1);
  return r[0] ?? null;
}

export async function productMovements(db: Db, productId: string, limit = 50) {
  return db.select().from(stockMovements).where(eq(stockMovements.productId, productId)).orderBy(desc(stockMovements.occurredAt), desc(stockMovements.id)).limit(limit);
}

export interface InventorySummary {
  products: number;
  lowStock: number;
  outOfStock: number;
  stockValueMinor: number;
}

export async function inventorySummary(db: Db): Promise<InventorySummary> {
  const live = and(isNull(products.deletedAt), eq(products.trackStock, true));
  const total = (await db.select({ n: count() }).from(products).where(isNull(products.deletedAt)))[0]?.n ?? 0;
  const low = (
    await db
      .select({ n: count() })
      .from(products)
      .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
      .where(and(live, sql`${products.lowStockMilli} IS NOT NULL AND coalesce(${stockLevels.qtyMilli}, 0) <= ${products.lowStockMilli}`))
  )[0]?.n ?? 0;
  const out = (await db.select({ n: count() }).from(products).leftJoin(stockLevels, eq(stockLevels.productId, products.id)).where(and(live, lte(sql`coalesce(${stockLevels.qtyMilli}, 0)`, 0))))[0]?.n ?? 0;
  const value = (await db.select({ v: sum(stockLevels.valueMinor) }).from(stockLevels).innerJoin(products, eq(products.id, stockLevels.productId)).where(live))[0]?.v;
  return { products: total, lowStock: low, outOfStock: out, stockValueMinor: Number(value ?? 0) };
}
