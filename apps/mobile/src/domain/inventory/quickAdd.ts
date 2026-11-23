/**
 * «أضف أصنافك بسرعة»: create products on the fly (scanned invoice / photographed list / scan-and-add) and put their
 * stock in, all in ONE transaction — if anything fails, no product is left behind.
 * - units come from the written unit word (كرتونه → كرتونة); a standard unit the shop does not have yet is created;
 * - the plan's product limit is checked for the whole batch first (ProductLimitError says how many fit);
 * - products made with a guessed or missing sale price are marked `needsPriceReview`.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { HybridLogicalClock, normalizeArabicForSearch, normalizeBarcode, uuidv7 } from '@daftarak/shared';
import { barcodes, products, productUnits, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite } from '../licence/guard';
import { InventoryError, nowOf, type InvCtx } from './context';
import { defaultUnitId } from './catalog';
import { assertProductSlots, insertProductRows, postOpeningStock } from './products';
import { postCountedLevels } from './adjust';
import { normName, unitFromWord } from './quickPricing';

let hlc: HybridLogicalClock | null = null;
const tick = (ctx: InvCtx) => (hlc ??= new HybridLogicalClock(ctx.device.code)).tick();

/** A product to create while posting (invoice line / list line / scanned barcode). Prices per its (base) unit. */
export interface NewProductSpec {
  name: string;
  /** Unit word as read or picked (كرتونة / علبة / كيلو…); null = قطعة. */
  unit: string | null;
  costMinor: number;
  /** 0 allowed only with needsPriceReview («سيب السعر بعدين»). */
  retailPriceMinor: number;
  needsPriceReview: boolean;
  barcode?: string | null;
  categoryId?: string | null;
}

/** Same product twice in one batch (same name and unit) is created once. */
const specKey = (s: NewProductSpec) => `${normName(s.name)}|${normName(s.unit ?? '')}`;

/** Counts the distinct products a batch would create (for the plan-limit check before the transaction). */
export function distinctNewCount(specs: readonly NewProductSpec[]): number {
  return new Set(specs.map(specKey)).size;
}

export function validateSpec(s: NewProductSpec): void {
  if (!s.name.trim()) throw new InventoryError('name_required');
  for (const v of [s.costMinor, s.retailPriceMinor]) if (!Number.isSafeInteger(v) || v < 0) throw new InventoryError('invalid_price');
  if (!(s.retailPriceMinor > 0) && !s.needsPriceReview) throw new InventoryError('invalid_price');
}

/**
 * Unit id for a written unit word: a known word maps to its standard unit (found by Arabic / English name, created if
 * the shop has none); an unknown word matches an existing unit by name, else قطعة (no junk units from bad reads).
 * Call inside a transaction.
 */
export async function resolveUnitId(tx: Db, ctx: InvCtx, word: string | null | undefined, cache: Map<string, string>): Promise<string> {
  if (cache.size === 0) {
    for (const u of await tx.select().from(units).where(isNull(units.deletedAt))) {
      cache.set(normalizeArabicForSearch(u.nameAr), u.id);
      cache.set(normalizeArabicForSearch(u.nameEn), u.id);
    }
  }
  const raw = word?.trim();
  if (!raw) return defaultUnitId(tx);
  const std = unitFromWord(raw);
  const hit = cache.get(normalizeArabicForSearch(std?.ar ?? raw)) ?? (std ? cache.get(normalizeArabicForSearch(std.en)) : undefined);
  if (hit) return hit;
  if (!std) return defaultUnitId(tx);
  const now = nowOf(ctx);
  const id = uuidv7(now);
  await tx.insert(units).values({ id, nameAr: std.ar, nameEn: std.en, allowsFraction: std.fraction, sort: cache.size, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: tick(ctx) });
  cache.set(normalizeArabicForSearch(std.ar), id);
  cache.set(normalizeArabicForSearch(std.en), id);
  await appendAudit(tx, { action: 'unit.create', entity: 'units', entityId: id, after: { name: std.ar, auto: true }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
  return id;
}

export interface CreatedProduct {
  productId: string;
  baseUnitRowId: string;
  unitName: string;
}

/**
 * Inserts the products of a batch (deduplicated by name + unit) with their units and barcodes. No permission / limit
 * checks and no transaction of its own: callers check first and run this inside their withTx. Returns one entry per
 * spec (twins share an entry).
 */
export async function createNewProducts(tx: Db, ctx: InvCtx, specs: readonly NewProductSpec[], now: number, source: string): Promise<CreatedProduct[]> {
  const unitCache = new Map<string, string>();
  const made = new Map<string, CreatedProduct>();
  const codes = [...new Set(specs.map((s) => (s.barcode ? normalizeBarcode(s.barcode) : '')).filter(Boolean))];
  if (codes.length) {
    const taken = await tx.select({ code: barcodes.code, name: products.name }).from(barcodes).innerJoin(products, eq(products.id, barcodes.productId)).where(and(inArray(barcodes.code, codes), isNull(barcodes.deletedAt)));
    if (taken[0]) throw new InventoryError('barcode_taken', { code: taken[0].code, productName: taken[0].name });
  }
  const out: CreatedProduct[] = [];
  for (const s of specs) {
    validateSpec(s);
    const key = specKey(s);
    const prev = made.get(key);
    if (prev) {
      out.push(prev);
      continue;
    }
    const baseUnitId = await resolveUnitId(tx, ctx, s.unit, unitCache);
    const unitName = (await tx.select({ n: units.nameAr }).from(units).where(eq(units.id, baseUnitId)).limit(1))[0]?.n ?? s.unit ?? '';
    const { productId, baseUnitRowId } = await insertProductRows(
      tx,
      ctx,
      {
        name: s.name.trim(),
        categoryId: s.categoryId ?? null,
        baseUnitId,
        costMinor: s.costMinor,
        retailPriceMinor: s.retailPriceMinor,
        wholesalePriceMinor: s.retailPriceMinor,
        trackStock: true,
        trackExpiry: false,
        barcodes: s.barcode ? [s.barcode] : [],
        needsPriceReview: s.needsPriceReview,
      },
      now,
    );
    await appendAudit(tx, {
      action: 'product.create',
      entity: 'products',
      entityId: productId,
      after: { name: s.name.trim(), cost: s.costMinor, retail: s.retailPriceMinor, unit: unitName, source, review: s.needsPriceReview },
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: now,
    });
    const c = { productId, baseUnitRowId, unitName };
    made.set(key, c);
    out.push(c);
  }
  return out;
}

/** Permission + plan-limit check for a batch of new products (before any transaction). */
export async function assertCanCreate(ctx: InvCtx, specs: readonly NewProductSpec[]): Promise<void> {
  if (!specs.length) return;
  requirePermission(ctx.user, 'products.manage');
  specs.forEach(validateSpec);
  await assertProductSlots(ctx.db, distinctNewCount(specs));
}

/** One line of «أضف أصنافك بسرعة» (list / scan-add): an existing product OR a new one, and how much is on hand. */
export interface QuickStockItem {
  /** Existing product: its id. */
  productId?: string | null;
  /** Unit row (product_units.id) the qty is in, for an existing product; null = base unit (or `unit`). */
  productUnitId?: string | null;
  /**
   * Or the unit as written (كرتونة…), when no productUnitId: it must be one of the existing product's units, else
   * InventoryError('unit_mismatch') — never a silent fallback to the base unit (2 كرتونة ≠ 2 pieces).
   */
  unit?: string | null;
  /** New product. */
  create?: NewProductSpec | null;
  /** On-hand quantity in that unit (milli); 0 = no stock line. */
  qtyMilli: number;
  /** Cost per that unit for the opening value (existing product; null = its current cost). */
  costMinor?: number | null;
}

export interface QuickStockResult {
  created: number;
  productIds: string[];
  openingDocId: string | null;
  /** existing: 'count' — the COUNT document that set the existing products to the listed quantities. */
  countDocId: string | null;
}

export interface QuickStockOptions {
  note?: string;
  source?: string;
  /**
   * What a quantity on an EXISTING product means: 'add' (default; scan-and-add, a delivery list) = on top of the
   * current stock (opening stock in); 'count' (a paper stock-take) = the counted on-hand quantity: ONE posted COUNT
   * document adjusts each product by counted − current (journal and ledger as a stock count). New products always
   * get opening stock.
   */
  existing?: 'add' | 'count';
}

/**
 * Creates the new products and posts ONE opening-stock document for every line with a quantity (new products, and
 * existing ones in 'add' mode) and, in 'count' mode, ONE count document for the existing products — all in one
 * transaction. Existing products need stock.adjust; new ones products.manage + plan room.
 */
export async function quickAddStock(ctx: InvCtx, items: readonly QuickStockItem[], opts: QuickStockOptions = {}): Promise<QuickStockResult> {
  assertCanWrite();
  const specs = items.map((i) => i.create).filter((x): x is NewProductSpec => !!x);
  for (const i of items) {
    if (!i.create && !i.productId) throw new InventoryError('not_found');
    if (!Number.isSafeInteger(i.qtyMilli) || i.qtyMilli < 0) throw new InventoryError('invalid_qty');
    if (i.costMinor != null && (!Number.isSafeInteger(i.costMinor) || i.costMinor < 0)) throw new InventoryError('invalid_price');
  }
  if (items.some((i) => !i.create && i.qtyMilli > 0)) requirePermission(ctx.user, 'stock.adjust');
  await assertCanCreate(ctx, specs);
  const source = opts.source ?? 'quick_add';
  return withTx(ctx.db, async (tx) => {
    const now = nowOf(ctx);
    const created = await createNewProducts(tx, ctx, specs, now, source);
    let k = 0;
    const opening: { productId: string; qtyMilli: number; unitCostMinor: number }[] = [];
    const counted = new Map<string, number>();
    const ids: string[] = [];
    for (const i of items) {
      if (i.create) {
        const c = created[k++]!;
        ids.push(c.productId);
        if (i.qtyMilli > 0) opening.push({ productId: c.productId, qtyMilli: i.qtyMilli, unitCostMinor: i.create.costMinor });
        continue;
      }
      const p = (await tx.select().from(products).where(eq(products.id, i.productId!)).limit(1))[0];
      if (!p || p.deletedAt) throw new InventoryError('not_found');
      ids.push(p.id);
      if (!(i.qtyMilli > 0) || !p.trackStock) continue;
      let factor = 1000;
      if (i.productUnitId) {
        const u = (await tx.select({ f: productUnits.factorMilli }).from(productUnits).where(and(eq(productUnits.id, i.productUnitId), eq(productUnits.productId, p.id), isNull(productUnits.deletedAt))).limit(1))[0];
        if (!u) throw new InventoryError('unit_mismatch', { name: p.name, unit: i.unit ?? '' });
        factor = u.f;
      } else if (i.unit) {
        const want = normName(unitFromWord(i.unit)?.ar ?? i.unit);
        const pus = await tx.select({ f: productUnits.factorMilli, ar: units.nameAr }).from(productUnits).innerJoin(units, eq(units.id, productUnits.unitId)).where(and(eq(productUnits.productId, p.id), isNull(productUnits.deletedAt)));
        const hit = pus.find((u) => normName(u.ar) === want);
        // «2 كرتونة» of a product without a carton unit: refuse (the caller picks one of the product's units).
        if (!hit) throw new InventoryError('unit_mismatch', { name: p.name, unit: unitFromWord(i.unit)?.ar ?? i.unit });
        factor = hit.f;
      }
      const baseQty = Math.round((i.qtyMilli * factor) / 1000);
      if (opts.existing === 'count') {
        counted.set(p.id, (counted.get(p.id) ?? 0) + baseQty);
        continue;
      }
      const baseCost = i.costMinor != null ? Math.round((i.costMinor * 1000) / factor) : p.costMinor;
      opening.push({ productId: p.id, qtyMilli: baseQty, unitCostMinor: baseCost });
    }
    // Same product on two lines → one opening line with the summed quantity (first line's cost).
    const merged = new Map<string, { productId: string; qtyMilli: number; unitCostMinor: number }>();
    for (const o of opening) {
      const m = merged.get(o.productId);
      if (m) m.qtyMilli += o.qtyMilli;
      else merged.set(o.productId, { ...o });
    }
    const openingDocId = await postOpeningStock(tx, ctx, [...merged.values()], now, opts.note ?? source);
    const countDocId = await postCountedLevels(tx, ctx, [...counted].map(([productId, countedMilli]) => ({ productId, countedMilli })), now, opts.note ?? source);
    await appendAudit(tx, {
      action: 'product.quick_add',
      entity: 'products',
      after: { source, created: new Set(created.map((c) => c.productId)).size, lines: items.length, opening: openingDocId, count: countDocId },
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: now,
    });
    return { created: new Set(created.map((c) => c.productId)).size, productIds: ids, openingDocId, countDocId };
  });
}
