/** Stock adjustments (with reason) and scan-driven stock counts (SPEC §5). */
import { and, asc, desc, eq, isNull, ne, notInArray } from 'drizzle-orm';
import { uuidv7 } from '@daftarak/shared';
import { inventoryDocs, inventoryLines, products, stockLevels, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite } from '../licence/guard';
import { InventoryError, nowOf, type InvCtx } from './context';
import { defaultWarehouseId, getLevel, postMovements } from './ledger';
import { finalizeInventoryDoc } from './postDoc';

export const ADJUST_REASONS = ['damaged', 'expired', 'lost', 'gift', 'own_use', 'found', 'correction', 'other'] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

/** One-product adjustment as a posted ADJUST document. deltaMilli may be + or −. */
export async function postAdjustment(ctx: InvCtx, input: { productId: string; deltaMilli: number; reason: AdjustReason; note?: string | null }): Promise<string> {
  requirePermission(ctx.user, 'stock.adjust');
  assertCanWrite();
  if (!Number.isSafeInteger(input.deltaMilli) || input.deltaMilli === 0) throw new InventoryError('invalid_qty');
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    const p = (await tx.select({ name: products.name }).from(products).where(and(eq(products.id, input.productId), isNull(products.deletedAt))).limit(1))[0];
    if (!p) throw new InventoryError('not_found');
    const warehouseId = await defaultWarehouseId(tx);
    const before = await getLevel(tx, input.productId, warehouseId);
    const docId = uuidv7(now);
    const base = { createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id };
    await tx.insert(inventoryDocs).values({ id: docId, ...base, type: 'ADJUST', status: 'DRAFT', warehouseId, reason: input.reason, note: input.note ?? null });
    const lineId = uuidv7(now);
    await tx.insert(inventoryLines).values({ id: lineId, ...base, docId, productId: input.productId, expectedMilli: before.qtyMilli, countedMilli: before.qtyMilli + input.deltaMilli, deltaMilli: input.deltaMilli });
    const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: input.productId, qtyMilli: input.deltaMilli, type: 'ADJUST', sourceType: 'inventory_doc', sourceId: docId, sourceLineId: lineId, reason: input.reason }]);
    await tx.update(inventoryLines).set({ unitCostMinor: mv!.unitCostMinor }).where(eq(inventoryLines.id, lineId));
    await finalizeInventoryDoc(tx, ctx, docId, now, mv!.valueMinor);
    await appendAudit(tx, {
      action: 'stock.adjust',
      entity: 'inventory_docs',
      entityId: docId,
      before: { qty: before.qtyMilli },
      after: { qty: before.qtyMilli + input.deltaMilli, delta: input.deltaMilli, product: p.name },
      reason: [input.reason, input.note].filter(Boolean).join(': '),
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: now,
    });
    return docId;
  });
}

// ───────────── stock count (جرد) ─────────────
//
// A count is an inventory_docs row (type COUNT) that stays DRAFT while people scan: every scan/edit is written
// straight away (nothing to "save"), so leaving the screen and coming back resumes it. Only one open count at a
// time. Optional name (note) and scope (one category → reason = "cat:<id>"). Posting adjusts counted products
// only (or, if asked, also zeroes the uncounted products of the scope). Discarding keeps the doc as DISCARDED
// (shown in the count report) and never touches stock.

export interface CountOptions {
  /** «جرد آخر الشهر» … */
  note?: string | null;
  /** Count one category only (partial count). */
  categoryId?: string | null;
}

export const scopeReason = (categoryId: string | null | undefined) => (categoryId ? `cat:${categoryId}` : null);
export const scopeCategoryId = (reason: string | null | undefined) => (reason?.startsWith('cat:') ? reason.slice(4) : null);

export interface OpenCount {
  id: string;
  note: string | null;
  categoryId: string | null;
  createdAt: number;
}

/** The open (draft) count, if any. */
export async function getOpenCount(db: Db): Promise<OpenCount | null> {
  const d = (await db.select().from(inventoryDocs).where(and(eq(inventoryDocs.type, 'COUNT'), eq(inventoryDocs.status, 'DRAFT'))).orderBy(desc(inventoryDocs.createdAt)).limit(1))[0];
  return d ? { id: d.id, note: d.note, categoryId: scopeCategoryId(d.reason), createdAt: d.createdAt } : null;
}

/** The open count session, or a new one (with the given name/scope). Only one draft count at a time. */
export async function openCount(ctx: InvCtx, opts: CountOptions = {}): Promise<string> {
  requirePermission(ctx.user, 'stock.adjust');
  assertCanWrite();
  const existing = await getOpenCount(ctx.db);
  if (existing) return existing.id;
  const now = nowOf(ctx);
  const id = uuidv7(now);
  const note = opts.note?.trim() || null;
  await withTx(ctx.db, async (tx) => {
    await tx.insert(inventoryDocs).values({ id, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, type: 'COUNT', status: 'DRAFT', warehouseId: await defaultWarehouseId(tx), note, reason: scopeReason(opts.categoryId) });
  });
  return id;
}

/** Rename / re-scope the open count. */
export async function updateCountInfo(ctx: InvCtx, docId: string, opts: CountOptions): Promise<void> {
  requirePermission(ctx.user, 'stock.adjust');
  const now = nowOf(ctx);
  await withTx(ctx.db, async (tx) => {
    const doc = (await tx.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
    if (!doc || doc.status !== 'DRAFT') throw new InventoryError('not_found');
    const set: Partial<typeof inventoryDocs.$inferInsert> = { updatedAt: now };
    if (opts.note !== undefined) set.note = opts.note?.trim() || null;
    if (opts.categoryId !== undefined) set.reason = scopeReason(opts.categoryId);
    await tx.update(inventoryDocs).set(set).where(eq(inventoryDocs.id, docId));
  });
}

/** Scan / tap: add to the counted quantity (mode 'add') or set it (mode 'set'). */
export async function countItem(ctx: InvCtx, docId: string, productId: string, qtyMilli: number, mode: 'add' | 'set' = 'add'): Promise<number> {
  requirePermission(ctx.user, 'stock.adjust');
  if (!Number.isSafeInteger(qtyMilli)) throw new InventoryError('invalid_qty');
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    const doc = (await tx.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
    if (!doc || doc.status !== 'DRAFT') throw new InventoryError('not_found');
    const scope = scopeCategoryId(doc.reason);
    if (scope) {
      const p = (await tx.select({ categoryId: products.categoryId, name: products.name }).from(products).where(eq(products.id, productId)).limit(1))[0];
      if (!p) throw new InventoryError('not_found');
      if (p.categoryId !== scope) throw new InventoryError('out_of_scope', { name: p.name });
    }
    const line = (await tx.select().from(inventoryLines).where(and(eq(inventoryLines.docId, docId), eq(inventoryLines.productId, productId))).limit(1))[0];
    const counted = Math.max(0, mode === 'add' ? (line?.countedMilli ?? 0) + qtyMilli : qtyMilli);
    if (line) await tx.update(inventoryLines).set({ countedMilli: counted, updatedAt: now }).where(eq(inventoryLines.id, line.id));
    else {
      // Snapshot of the system quantity when the shelf was counted: sales/purchases posted while the count is still
      // open move the system quantity, and posting must not overwrite them (delta = counted − snapshot).
      const level = await getLevel(tx, productId, doc.warehouseId);
      await tx.insert(inventoryLines).values({ id: uuidv7(now), createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, docId, productId, expectedMilli: level.qtyMilli, countedMilli: counted, deltaMilli: 0 });
    }
    await tx.update(inventoryDocs).set({ updatedAt: now }).where(eq(inventoryDocs.id, docId));
    return counted;
  });
}

export async function removeCountItem(ctx: InvCtx, docId: string, productId: string): Promise<void> {
  requirePermission(ctx.user, 'stock.adjust');
  await withTx(ctx.db, async (tx) => {
    const doc = (await tx.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
    if (!doc || doc.status !== 'DRAFT') throw new InventoryError('not_found');
    const line = (await tx.select().from(inventoryLines).where(and(eq(inventoryLines.docId, docId), eq(inventoryLines.productId, productId))).limit(1))[0];
    if (line) await tx.delete(inventoryLines).where(eq(inventoryLines.id, line.id));
  });
}

export interface CountLine {
  productId: string;
  name: string;
  variantLabel: string | null;
  unitName: string;
  countedMilli: number;
  expectedMilli: number;
  /** Moving-average cost per base unit (falls back to the product cost) — values the difference. */
  unitCostMinor: number;
}

/** Lines of a draft count; "expected" = the system quantity when the product was first counted (the snapshot). */
export async function countLines(db: Db, docId: string): Promise<CountLine[]> {
  const rows = await db
    .select({
      productId: inventoryLines.productId,
      name: products.name,
      variantLabel: products.variantLabel,
      unitName: units.nameAr,
      countedMilli: inventoryLines.countedMilli,
      expectedMilli: inventoryLines.expectedMilli,
      currentMilli: stockLevels.qtyMilli,
      avgCostMinor: stockLevels.avgCostMinor,
      costMinor: products.costMinor,
      updatedAt: inventoryLines.updatedAt,
    })
    .from(inventoryLines)
    .innerJoin(products, eq(products.id, inventoryLines.productId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .leftJoin(stockLevels, eq(stockLevels.productId, inventoryLines.productId))
    .where(eq(inventoryLines.docId, docId))
    .orderBy(desc(inventoryLines.updatedAt));
  return rows.map((r) => ({ productId: r.productId, name: r.name, variantLabel: r.variantLabel, unitName: r.unitName, countedMilli: r.countedMilli ?? 0, expectedMilli: r.expectedMilli ?? r.currentMilli ?? 0, unitCostMinor: r.avgCostMinor || r.costMinor || 0 }));
}

/**
 * Post the count: for every counted product, difference = counted − system quantity WHEN IT WAS COUNTED (snapshot).
 * Movements posted after the snapshot (sales while counting) stay: the final quantity = counted + those movements.
 * Products not counted keep their quantity — unless `missing: 'zero'`: then every uncounted stock-tracked product
 * of the count's scope (its category, or all products) with a non-zero quantity is counted as 0.
 */
export async function postCount(ctx: InvCtx, docId: string, opts: { missing?: 'keep' | 'zero' } = {}): Promise<{ number: string; changed: number; zeroed: number }> {
  requirePermission(ctx.user, 'stock.adjust');
  assertCanWrite();
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    const doc = (await tx.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
    if (!doc || doc.status !== 'DRAFT' || doc.type !== 'COUNT') throw new InventoryError('not_found');
    let zeroed = 0;
    if (opts.missing === 'zero') {
      for (const m of await uncountedInScope(tx, doc.id, scopeCategoryId(doc.reason), doc.warehouseId)) {
        await tx.insert(inventoryLines).values({ id: uuidv7(now), createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, docId, productId: m.productId, expectedMilli: m.qtyMilli, countedMilli: 0, deltaMilli: 0 });
        zeroed++;
      }
    }
    const lines = await tx.select().from(inventoryLines).where(eq(inventoryLines.docId, docId)).orderBy(asc(inventoryLines.createdAt));
    if (!lines.length) throw new InventoryError('empty_count');
    let changed = 0;
    let value = 0;
    for (const l of lines) {
      const level = await getLevel(tx, l.productId, doc.warehouseId);
      // Lines saved before snapshots existed fall back to the quantity at posting time.
      const expected = l.expectedMilli ?? level.qtyMilli;
      const delta = (l.countedMilli ?? 0) - expected;
      let unitCost = level.avgCostMinor;
      if (delta !== 0) {
        changed++;
        // COUNT differences never block on negative policy: the shelf is the truth.
        const [mv] = await postMovements(tx, { ...ctx, negativeStock: 'warn' }, doc.warehouseId, [{ productId: l.productId, qtyMilli: delta, type: 'COUNT', sourceType: 'inventory_doc', sourceId: docId, sourceLineId: l.id, reason: 'count' }]);
        value += mv!.valueMinor;
        unitCost = mv!.unitCostMinor;
      }
      await tx.update(inventoryLines).set({ expectedMilli: expected, deltaMilli: delta, unitCostMinor: unitCost, updatedAt: now }).where(eq(inventoryLines.id, l.id));
    }
    const number = await finalizeInventoryDoc(tx, ctx, docId, now, value);
    await appendAudit(tx, { action: 'stock.count', entity: 'inventory_docs', entityId: docId, after: { number, lines: lines.length, changed, zeroed, note: doc.note, scope: doc.reason }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
    return { number, changed, zeroed };
  });
}

/** Stock-tracked live products of the scope that were not counted and whose system quantity is not 0. */
export async function uncountedInScope(db: Db, docId: string, categoryId: string | null, warehouseId?: string): Promise<{ productId: string; qtyMilli: number }[]> {
  const wh = warehouseId ?? (await defaultWarehouseId(db));
  const conds = [isNull(products.deletedAt), eq(products.trackStock, true), ne(stockLevels.qtyMilli, 0), notInArray(products.id, db.select({ id: inventoryLines.productId }).from(inventoryLines).where(eq(inventoryLines.docId, docId)))];
  if (categoryId) conds.push(eq(products.categoryId, categoryId));
  return db
    .select({ productId: products.id, qtyMilli: stockLevels.qtyMilli })
    .from(products)
    .innerJoin(stockLevels, and(eq(stockLevels.productId, products.id), eq(stockLevels.warehouseId, wh)))
    .where(and(...conds));
}

/** Cancel the open count: stock is not touched; the count stays in the report as «اتلغى». */
export async function discardCount(ctx: InvCtx, docId: string): Promise<void> {
  requirePermission(ctx.user, 'stock.adjust');
  const now = nowOf(ctx);
  await withTx(ctx.db, async (tx) => {
    const doc = (await tx.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
    if (!doc || doc.status !== 'DRAFT' || doc.type !== 'COUNT') throw new InventoryError('not_found');
    const n = (await tx.select({ id: inventoryLines.id }).from(inventoryLines).where(eq(inventoryLines.docId, docId))).length;
    if (!n) {
      // Nothing counted: nothing worth keeping.
      await tx.delete(inventoryDocs).where(eq(inventoryDocs.id, docId));
      return;
    }
    await tx.update(inventoryDocs).set({ status: 'DISCARDED', updatedAt: now }).where(eq(inventoryDocs.id, docId));
    await appendAudit(tx, { action: 'stock.count_discard', entity: 'inventory_docs', entityId: docId, after: { lines: n, note: doc.note }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
  });
}
