/**
 * Photographed item list (stock list / notebook / price list) → review rows → products + opening stock. Pure.
 * Each row is matched to an existing product (exact / whole-word; a look-alike is only suggested) or becomes a new
 * product with a cleaned name, the written unit, qty, cost and a sale price (from the list, else cost + markup).
 * A new product needs a sale price, unless the user chose «سيب السعر بعدين» (then it is marked for price review).
 */
import type { OcrListLine } from '@daftarak/shared';
import { matchByName, toMilli, toMinor, type MatchKind, type NamedItem } from '../purchases/ocrMatch';
import { fuzzyIndex, markupPrice, normName, splitNameUnit, unitFromWord, type QuickPricing } from './quickPricing';
import type { QuickStockItem } from './quickAdd';

/** One of an existing product's units (product_units row) for the row's unit picker. */
export interface ListUnit {
  id: string;
  name: string;
  factorMilli: number;
  isBase: boolean;
}

/** What the list's quantities mean for EXISTING products: the counted on-hand quantity (جرد) or an amount to add. */
export type ListQtyMode = 'count' | 'add';

export interface ListRow<P extends NamedItem = NamedItem> {
  key: string;
  /** As read from the photo. */
  read: string;
  product: P | null;
  match: MatchKind | 'picked' | 'confirmed' | 'create' | null;
  suggestion: P | null;
  /** New product: cleaned name and unit (Arabic standard unit name; null = قطعة). Existing product: the unit word read. */
  name: string;
  unit: string | null;
  /** Existing product: the product unit (product_units.id) the qty is in; null = base unit. */
  productUnitId: string | null;
  /** Existing product: the unit word read is not one of its units — the user must pick one. */
  unitUnsure: boolean;
  /** On hand, in the chosen unit (existing: productUnitId / base; new: the new unit). 0 = no stock line. */
  qtyMilli: number;
  /** Cost per unit (minor); null = not known (a new product goes in at 0 and is marked for review). */
  costMinor: number | null;
  /** Sale price per unit for a new product. */
  saleMinor: number | null;
  /** Where the sale price came from: the list, the markup, or the user. */
  saleFrom: 'list' | 'markup' | 'typed' | null;
  /** «سيب السعر بعدين». */
  priceLater: boolean;
  skip: boolean;
}

/**
 * Unit of an existing product for a list row: the product's unit named by the word read (كرتونة → its carton), the
 * base unit when nothing was written; a word the product has no unit for is NOT taken as the base unit (2 كرتونة ≠ 2
 * pieces): the row needs a unit choice.
 */
export function pickRowUnit(word: string | null | undefined, units: readonly ListUnit[]): { productUnitId: string | null; unitUnsure: boolean } {
  const base = units.find((u) => u.isBase) ?? null;
  if (!word?.trim()) return { productUnitId: base?.id ?? null, unitUnsure: false };
  const want = normName(unitFromWord(word)?.ar ?? word);
  const hit = units.find((u) => normName(u.name) === want);
  return hit ? { productUnitId: hit.id, unitUnsure: false } : { productUnitId: null, unitUnsure: true };
}

/** Existing product rows: the quantity in base units (for «الموجود X ← هيبقى Y»); null while its units are unknown. */
export function rowBaseQty(r: ListRow, units: readonly ListUnit[] | undefined): number | null {
  if (r.unitUnsure) return null;
  const u = r.productUnitId ? units?.find((x) => x.id === r.productUnitId) : units?.find((x) => x.isBase);
  const f = u?.factorMilli ?? (r.productUnitId ? null : 1000);
  return f == null ? null : Math.round((r.qtyMilli * f) / 1000);
}

/** On hand after confirming: count = the listed quantity, add = current + listed. */
export function resultingQty(mode: ListQtyMode, currentMilli: number, listedBaseMilli: number): number {
  return mode === 'count' ? listedBaseMilli : currentMilli + listedBaseMilli;
}

export function buildListReview<P extends NamedItem & { units?: readonly ListUnit[] }>(lines: readonly OcrListLine[], products: readonly P[], opts: { autoCreate: boolean; pricing: QuickPricing }): ListRow<P>[] {
  const fuzzy = fuzzyIndex(products);
  return lines.map((l, i) => {
    const m = matchByName(l.name, products);
    const sel = m && m.kind !== 'partial' ? m : null;
    const suggestion = sel ? null : m?.kind === 'partial' ? m.item : fuzzy.find(l.name);
    const split = splitNameUnit(l.name);
    const unit = unitFromWord(l.unit) ?? split.unit;
    const cost = toMinor(l.cost);
    const listed = toMinor(l.price);
    const sale = listed && listed > 0 ? listed : markupPrice(cost, opts.pricing);
    const create = !sel && !suggestion && opts.autoCreate;
    // Existing product: its own unit named by the word; units not known yet → decided when they load (see pickRowUnit).
    const pu = sel ? (sel.item.units ? pickRowUnit(unit?.ar ?? l.unit, sel.item.units) : { productUnitId: null, unitUnsure: !!(unit ?? l.unit?.trim()) }) : { productUnitId: null, unitUnsure: false };
    return {
      key: `list-${i}`,
      read: l.name,
      product: sel?.item ?? null,
      match: sel?.kind ?? (create ? 'create' : null),
      suggestion: suggestion ?? null,
      name: split.name || l.name.trim(),
      unit: unit?.ar ?? (sel ? l.unit?.trim() || null : null),
      ...pu,
      qtyMilli: toMilli(l.qty),
      costMinor: cost,
      saleMinor: sale,
      saleFrom: listed && listed > 0 ? 'list' : sale != null ? 'markup' : null,
      priceLater: false,
      skip: false,
    };
  });
}

export type ListProblem = 'product' | 'confirm' | 'unit' | 'name' | 'price';

/** Why a (not skipped) row cannot go in yet. Empty = ready. */
export function listProblems(r: ListRow): ListProblem[] {
  if (r.skip) return [];
  if (r.match === 'create') {
    const p: ListProblem[] = [];
    if (!r.name.trim()) p.push('name');
    if (!(r.saleMinor != null && r.saleMinor > 0) && !r.priceLater) p.push('price');
    return p;
  }
  if (!r.product) return ['product'];
  if (r.match === 'contains') return ['confirm'];
  if (r.unitUnsure && r.qtyMilli > 0) return ['unit'];
  return [];
}

/** A new row is marked for price review when its cost is unknown, its price was left for later or only guessed. */
export function rowNeedsReview(r: ListRow): boolean {
  return r.priceLater || r.costMinor == null || !(r.saleMinor != null && r.saleMinor > 0) || r.saleFrom === 'markup';
}

/** Ready rows → quickAddStock items (existing rows without a quantity are dropped: nothing to do). */
export function listToStockItems(rows: readonly ListRow[]): QuickStockItem[] {
  const out: QuickStockItem[] = [];
  for (const r of rows) {
    if (r.skip || listProblems(r).length) continue;
    if (r.match === 'create') {
      const sale = r.priceLater ? 0 : (r.saleMinor ?? 0);
      out.push({ create: { name: r.name.trim(), unit: r.unit, costMinor: r.costMinor ?? 0, retailPriceMinor: sale, needsPriceReview: rowNeedsReview(r) }, qtyMilli: r.qtyMilli });
    } else if (r.product && r.qtyMilli > 0) {
      // The picked unit row wins; a bare word is checked by the domain (unit_mismatch, never a silent base unit).
      out.push({ productId: r.product.id, qtyMilli: r.qtyMilli, costMinor: r.costMinor, ...(r.productUnitId ? { productUnitId: r.productUnitId } : r.unit ? { unit: r.unit } : {}) });
    }
  }
  return out;
}
