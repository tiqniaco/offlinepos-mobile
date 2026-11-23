/**
 * Photographed item list (stock list / notebook / price list) → review rows → products + opening stock. Pure.
 * Each row is matched to an existing product (exact / whole-word; a look-alike is only suggested) or becomes a new
 * product with a cleaned name, the written unit, qty, cost and a sale price (from the list, else cost + markup).
 * A new product needs a sale price, unless the user chose «سيب السعر بعدين» (then it is marked for price review).
 */
import type { OcrListLine } from '@daftarak/shared';
import { matchByName, toMilli, toMinor, type MatchKind, type NamedItem } from '../purchases/ocrMatch';
import { fuzzyIndex, markupPrice, splitNameUnit, unitFromWord, type QuickPricing } from './quickPricing';
import type { QuickStockItem } from './quickAdd';

export interface ListRow<P extends NamedItem = NamedItem> {
  key: string;
  /** As read from the photo. */
  read: string;
  product: P | null;
  match: MatchKind | 'picked' | 'confirmed' | 'create' | null;
  suggestion: P | null;
  /** New product: cleaned name and unit (Arabic standard unit name; null = قطعة). */
  name: string;
  unit: string | null;
  /** On hand, in the product's base unit (existing) or the new unit. 0 = no stock line. */
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

export function buildListReview<P extends NamedItem>(lines: readonly OcrListLine[], products: readonly P[], opts: { autoCreate: boolean; pricing: QuickPricing }): ListRow<P>[] {
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
    return {
      key: `list-${i}`,
      read: l.name,
      product: sel?.item ?? null,
      match: sel?.kind ?? (create ? 'create' : null),
      suggestion: suggestion ?? null,
      name: split.name || l.name.trim(),
      unit: unit?.ar ?? null,
      qtyMilli: toMilli(l.qty),
      costMinor: cost,
      saleMinor: sale,
      saleFrom: listed && listed > 0 ? 'list' : sale != null ? 'markup' : null,
      priceLater: false,
      skip: false,
    };
  });
}

export type ListProblem = 'product' | 'confirm' | 'name' | 'price';

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
      out.push({ productId: r.product.id, qtyMilli: r.qtyMilli, costMinor: r.costMinor, ...(r.unit ? { unit: r.unit } : {}) });
    }
  }
  return out;
}
