/**
 * Stock ledger (PLAN.md §6): the ONLY code that writes stock_movements and stock_levels.
 * Movements are appended and the cached level is updated in the caller's transaction.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { applyMovement, businessDay, EMPTY_LEVEL, uuidv7, type MovementType, type StockLevel } from '@daftarak/shared';
import { products, stockLevels, stockMovements, warehouses } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { InventoryError, nowOf, type InvCtx } from './context';

/** Movement types that carry their own unit cost (everything else is valued at the moving average). */
export const COST_CARRYING: readonly MovementType[] = ['OPENING', 'PURCHASE', 'SALE_RETURN', 'VOID_REVERSAL'];

export interface NewMovement {
  productId: string;
  qtyMilli: number;
  type: MovementType;
  /** Required for COST_CARRYING types, ignored otherwise. */
  unitCostMinor?: number | null;
  sourceType: string;
  sourceId: string;
  sourceLineId?: string | null;
  reason?: string | null;
  batchId?: string | null;
}

export async function defaultWarehouseId(db: Db): Promise<string> {
  const w = (await db.select({ id: warehouses.id }).from(warehouses).where(and(eq(warehouses.isDefault, true), isNull(warehouses.deletedAt))).limit(1))[0];
  if (!w) throw new InventoryError('not_found', { what: 'warehouse' });
  return w.id;
}

export async function getLevel(db: Db, productId: string, warehouseId: string): Promise<StockLevel> {
  const r = (await db.select().from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId))).limit(1))[0];
  return r ? { qtyMilli: r.qtyMilli, avgCostMinor: r.avgCostMinor, valueMinor: r.valueMinor } : EMPTY_LEVEL;
}

/**
 * Append movements and update cached levels. Must run inside withTx (the caller's transaction).
 * Negative stock: 'warn' lets it through (the UI warned before), 'block' throws negative_blocked.
 */
export interface PostedMovement {
  productId: string;
  qtyMilli: number;
  unitCostMinor: number;
  /**
   * Change of the stock value caused by this movement, signed, minor units (= the movement's own value + trueUpMinor).
   * Post THIS to the INVENTORY account so the journal always equals Σ stock_levels.value_minor.
   */
  valueMinor: number;
  /** Part of valueMinor that re-values stock sold below zero (average reset); 0 for most movements. */
  trueUpMinor: number;
}

export async function postMovements(tx: Db, ctx: Pick<InvCtx, 'device' | 'user' | 'timezone' | 'negativeStock' | 'now'>, warehouseId: string, movements: NewMovement[]): Promise<PostedMovement[]> {
  const now = nowOf(ctx);
  const day = businessDay(now, ctx.timezone);
  const posted: PostedMovement[] = [];
  for (const m of movements) {
    if (!Number.isSafeInteger(m.qtyMilli) || m.qtyMilli === 0) throw new InventoryError('invalid_qty');
    const carries = COST_CARRYING.includes(m.type);
    if (carries && (m.unitCostMinor == null || m.unitCostMinor < 0)) throw new InventoryError('invalid_price');
    const product = (await tx.select({ cost: products.costMinor, trackStock: products.trackStock }).from(products).where(eq(products.id, m.productId)).limit(1))[0];
    if (!product) throw new InventoryError('not_found', { productId: m.productId });
    const current = await getLevel(tx, m.productId, warehouseId);
    if (m.qtyMilli < 0 && ctx.negativeStock === 'block' && product.trackStock && current.qtyMilli + m.qtyMilli < 0) {
      throw new InventoryError('negative_blocked', { productId: m.productId, available: current.qtyMilli });
    }
    const { level, unitCostMinor, valueMinor, trueUpMinor } = applyMovement(current, { qtyMilli: m.qtyMilli, unitCostMinor: carries ? m.unitCostMinor! : null }, product.cost);
    await tx.insert(stockMovements).values({
      id: uuidv7(now),
      productId: m.productId,
      warehouseId,
      batchId: m.batchId ?? null,
      qtyMilli: m.qtyMilli,
      unitCostMinor,
      type: m.type,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      sourceLineId: m.sourceLineId ?? null,
      reason: m.reason ?? null,
      businessDay: day,
      occurredAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: ctx.user.id,
      deviceId: ctx.device.id,
    });
    await tx
      .insert(stockLevels)
      .values({ productId: m.productId, warehouseId, qtyMilli: level.qtyMilli, avgCostMinor: level.avgCostMinor, valueMinor: level.valueMinor, lastMovementAt: now })
      .onConflictDoUpdate({
        target: [stockLevels.productId, stockLevels.warehouseId],
        set: { qtyMilli: level.qtyMilli, avgCostMinor: level.avgCostMinor, valueMinor: level.valueMinor, lastMovementAt: now },
      });
    posted.push({ productId: m.productId, qtyMilli: m.qtyMilli, unitCostMinor, valueMinor: valueMinor + trueUpMinor, trueUpMinor });
  }
  return posted;
}

export interface RebuildDiff {
  productId: string;
  warehouseId: string;
  cached: StockLevel;
  ledger: StockLevel;
}

/** Recompute every level from the ledger, in INSERTION order (rowid) — the order the incremental cache saw them, even if
 *  the clock moved or several movements share a millisecond. */
export async function computeLevelsFromLedger(db: Db): Promise<Map<string, StockLevel & { productId: string; warehouseId: string; lastMovementAt: number }>> {
  const rows = await db
    .select({
      productId: stockMovements.productId,
      warehouseId: stockMovements.warehouseId,
      qtyMilli: stockMovements.qtyMilli,
      unitCostMinor: stockMovements.unitCostMinor,
      type: stockMovements.type,
      occurredAt: stockMovements.occurredAt,
    })
    .from(stockMovements)
    .orderBy(sql`rowid`);
  const map = new Map<string, StockLevel & { productId: string; warehouseId: string; lastMovementAt: number }>();
  for (const r of rows) {
    const key = `${r.productId}|${r.warehouseId}`;
    const prev = map.get(key) ?? { ...EMPTY_LEVEL, productId: r.productId, warehouseId: r.warehouseId, lastMovementAt: 0 };
    const carries = COST_CARRYING.includes(r.type as MovementType);
    // Non-carrying movements stored the cost they were valued at; replaying with it as the fallback
    // reproduces exactly what the incremental update did.
    const { level } = applyMovement(prev, { qtyMilli: r.qtyMilli, unitCostMinor: carries ? r.unitCostMinor : null }, r.unitCostMinor);
    map.set(key, { ...level, productId: r.productId, warehouseId: r.warehouseId, lastMovementAt: r.occurredAt });
  }
  return map;
}

/** Compare the cache with the ledger without changing anything. Empty array = consistent. */
export async function checkStockLevels(db: Db): Promise<RebuildDiff[]> {
  const fromLedger = await computeLevelsFromLedger(db);
  const cached = await db.select().from(stockLevels);
  const diffs: RebuildDiff[] = [];
  const seen = new Set<string>();
  for (const c of cached) {
    const key = `${c.productId}|${c.warehouseId}`;
    seen.add(key);
    const l = fromLedger.get(key) ?? { ...EMPTY_LEVEL };
    if (l.qtyMilli !== c.qtyMilli || l.avgCostMinor !== c.avgCostMinor || l.valueMinor !== c.valueMinor) {
      diffs.push({ productId: c.productId, warehouseId: c.warehouseId, cached: { qtyMilli: c.qtyMilli, avgCostMinor: c.avgCostMinor, valueMinor: c.valueMinor }, ledger: { qtyMilli: l.qtyMilli, avgCostMinor: l.avgCostMinor, valueMinor: l.valueMinor } });
    }
  }
  for (const [key, l] of fromLedger) {
    if (!seen.has(key)) diffs.push({ productId: l.productId, warehouseId: l.warehouseId, cached: EMPTY_LEVEL, ledger: { qtyMilli: l.qtyMilli, avgCostMinor: l.avgCostMinor, valueMinor: l.valueMinor } });
  }
  return diffs;
}

/** Replace the cache with values recomputed from the ledger. Returns what was different before. */
export async function rebuildStockLevels(db: Db): Promise<RebuildDiff[]> {
  return withTx(db, async (tx) => {
    const diffs = await checkStockLevels(tx);
    const fromLedger = await computeLevelsFromLedger(tx);
    await tx.run(sql`DELETE FROM stock_levels`);
    for (const l of fromLedger.values()) {
      await tx.insert(stockLevels).values({ productId: l.productId, warehouseId: l.warehouseId, qtyMilli: l.qtyMilli, avgCostMinor: l.avgCostMinor, valueMinor: l.valueMinor, lastMovementAt: l.lastMovementAt });
    }
    return diffs;
  });
}
