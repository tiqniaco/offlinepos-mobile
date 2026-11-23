/**
 * Supplier-invoice scan (OCR) → purchase lines. Pure helpers: match the names read from the photo to the shop's own
 * products / suppliers, and convert the model's major-unit numbers into the app's minor units / milli-quantities.
 */
import type { OcrLine } from '@daftarak/shared';
import { fuzzyIndex, markupPrice, normName, splitNameUnit, unitFromWord, type QuickPricing } from '../inventory/quickPricing';

export { normName };

export interface NamedItem {
  id: string;
  name: string;
}
/**
 * exact: same normalised name. contains: one name is a whole-word part of the other (pre-selected, but the user must
 * confirm it). partial: only a raw substring ("سكر" inside "سكرية") — never pre-selected, shown as a suggestion.
 */
export type MatchKind = 'exact' | 'contains' | 'partial';
export interface NameMatch<T extends NamedItem> {
  item: T;
  kind: MatchKind;
}

const MIN_CONTAINS = 3;

/**
 * Best match for `name` among `items`: an exact normalised name first; otherwise a name that contains the other as
 * whole words (either way, 'contains'), else as a raw substring ('partial'); the closest length wins.
 * Short names (< 3 chars) never match by containment.
 */
export function matchByName<T extends NamedItem>(name: string, items: readonly T[]): NameMatch<T> | null {
  const q = normName(name);
  if (!q) return null;
  let best: { item: T; score: number; kind: MatchKind } | null = null;
  for (const it of items) {
    const n = normName(it.name);
    if (!n) continue;
    if (n === q) return { item: it, kind: 'exact' };
    if (n.length < MIN_CONTAINS || q.length < MIN_CONTAINS) continue;
    const word = ` ${q} `.includes(` ${n} `) || ` ${n} `.includes(` ${q} `);
    if (word || q.includes(n) || n.includes(q)) {
      // Word-boundary containment ranks above a raw substring; then the closest length wins.
      const score = (word ? 0 : 1000) + Math.abs(n.length - q.length);
      if (!best || score < best.score) best = { item: it, score, kind: word ? 'contains' : 'partial' };
    }
  }
  return best ? { item: best.item, kind: best.kind } : null;
}

/** Major units (e.g. 12.5 EGP) → minor units (1250); null / invalid → null. */
export function toMinor(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) || v < 0 ? null : Math.round(v * 100);
}

/** Quantity → milli-units (1.5 → 1500). Missing / zero / invalid → 0: the line needs the user to type it (never a silent 1). */
export function toMilli(q: number | null | undefined): number {
  return q == null || !Number.isFinite(q) || q <= 0 ? 0 : Math.max(1, Math.round(q * 1000));
}

/** Unit cost in minor units: the printed unit price, else line total ÷ qty. */
export function unitCostMinor(l: Pick<OcrLine, 'qty' | 'unitPrice' | 'total'>): number | null {
  const u = toMinor(l.unitPrice);
  if (u != null) return u;
  const t = toMinor(l.total);
  return t != null && l.qty > 0 ? Math.round(t / l.qty) : null;
}

/** A line that becomes a NEW product when the review is confirmed (default for a line nothing matches). */
export interface NewItem {
  /** Cleaned name (editable). */
  name: string;
  /** Standard unit (Arabic name) the line is in; null = قطعة. */
  unit: string | null;
  /** Sale price per that unit (minor); null = not set yet. */
  saleMinor: number | null;
  /** The user typed the sale price: a markup change no longer touches it. */
  saleEdited: boolean;
}

export interface ReviewLine<P extends NamedItem = NamedItem> {
  /** Stable key for the list. */
  key: string;
  /** Name as read from the invoice. */
  read: string;
  product: P | null;
  /** 'create' = becomes a new product (see newItem). */
  match: MatchKind | 'picked' | 'new' | 'confirmed' | 'create' | null;
  /** A look-alike (raw substring or a near spelling), offered but not selected: «تقصد X؟». */
  suggestion?: P | null;
  /** Set when match = 'create'. */
  newItem?: NewItem | null;
  /** Quantity in the chosen unit (milli); 0 = not read, the user must type it. */
  qtyMilli: number;
  /** Unit cost in minor units, per the chosen unit (as printed on the invoice). */
  costMinor: number | null;
  /** Printed line total (minor), when the invoice has one. */
  totalMinor: number | null;
  /** Unit cost was not printed: derived from the line total (the line keeps the exact total). */
  costFromTotal: boolean;
  /** The product unit (product_units.id) the invoice line is in; null = base unit. */
  unitId: string | null;
  /** Unit word printed on the line (standard Arabic name, e.g. كرتونة); null = none / not a unit word. */
  unitWord?: string | null;
  /** The printed unit word names a unit the default pick could not confirm: the user must pick the unit. */
  unitUnsure?: boolean;
  skip: boolean;
}

export interface BuildReviewOptions {
  /** Unmatched lines default to «صنف جديد» (the user may add products). */
  autoCreate?: boolean;
  /** Markup / rounding for the default sale price of new lines. */
  pricing?: QuickPricing;
}

/**
 * One review line per invoice line, auto-matched to the shop's products. Only exact and whole-word matches are
 * selected. A line with no match: a look-alike (substring or near spelling) is suggested and the user decides;
 * otherwise, with `autoCreate`, it becomes a new product (cleaned name, unit from the invoice, marked-up price).
 */
export function buildReview<P extends NamedItem>(lines: readonly OcrLine[], products: readonly P[], opts: BuildReviewOptions = {}): ReviewLine<P>[] {
  const fuzzy = fuzzyIndex(products);
  return lines.map((l, i) => {
    const m = matchByName(l.name, products);
    const sel = m && m.kind !== 'partial' ? m : null;
    const suggestion = sel ? null : m?.kind === 'partial' ? m.item : fuzzy.find(l.name);
    const costMinor = unitCostMinor(l);
    let newItem: NewItem | null = null;
    if (!sel && !suggestion && opts.autoCreate) {
      const split = splitNameUnit(l.name);
      const unit = unitFromWord(l.unit ?? null) ?? split.unit;
      newItem = { name: split.name || l.name.trim(), unit: unit?.ar ?? null, saleMinor: opts.pricing ? markupPrice(costMinor, opts.pricing) : null, saleEdited: false };
    }
    return {
      key: `ocr-${i}`,
      read: l.name,
      product: sel?.item ?? null,
      match: sel?.kind ?? (newItem ? 'create' : null),
      suggestion: suggestion ?? null,
      newItem,
      qtyMilli: toMilli(l.qty),
      costMinor,
      totalMinor: toMinor(l.total),
      costFromTotal: toMinor(l.unitPrice) == null && toMinor(l.total) != null,
      unitId: null,
      unitWord: unitFromWord(l.unit ?? null)?.ar ?? null,
      unitUnsure: false,
      skip: false,
    };
  });
}

/** Re-price every new line the user has not priced by hand (markup chip / settings). */
export function repriceNew<L extends ReviewLine>(lines: readonly L[], pricing: QuickPricing): L[] {
  return lines.map((l) => (l.match === 'create' && l.newItem && !l.newItem.saleEdited ? { ...l, newItem: { ...l.newItem, saleMinor: markupPrice(l.costMinor, pricing) } } : l));
}

export type ReviewProblem = 'product' | 'confirm' | 'unit' | 'qty' | 'cost' | 'name' | 'price';

/** Why a (not skipped) line can't go into the purchase yet. Empty = ready. */
export function reviewProblems(l: ReviewLine): ReviewProblem[] {
  if (l.skip) return [];
  const p: ReviewProblem[] = [];
  if (l.match === 'create') {
    if (!l.newItem?.name.trim()) p.push('name');
  } else if (!l.product) p.push('product');
  else if (l.match === 'contains') p.push('confirm');
  if (l.match !== 'create' && l.product && l.unitUnsure) p.push('unit');
  if (!(l.qtyMilli > 0)) p.push('qty');
  if (l.costMinor == null) p.push('cost');
  if (l.match === 'create' && !(l.newItem?.saleMinor != null && l.newItem.saleMinor > 0) && l.costMinor != null) p.push('price');
  return p;
}

export interface UnitOption {
  id: string;
  factorMilli: number;
  isBase: boolean;
}

/**
 * The unit an invoice line is most likely in (OCR gives no unit): the one whose current cost (product cost per base
 * unit × factor) is closest to the printed unit price, by ratio. E.g. a tea carton of 24 at 432.00 when a piece costs
 * 18.00 → the carton. Without a cost or a price: the base unit.
 */
export function pickUnit(units: readonly UnitOption[], baseCostMinor: number, scannedUnitPriceMinor: number | null): string | null {
  const base = units.find((u) => u.isBase) ?? units[0];
  if (!base) return null;
  if (!scannedUnitPriceMinor || scannedUnitPriceMinor <= 0 || !(baseCostMinor > 0) || units.length < 2) return base.id;
  let best = base;
  let bestD = Infinity;
  for (const u of units) {
    const cost = (baseCostMinor * u.factorMilli) / 1000;
    const d = Math.abs(Math.log(scannedUnitPriceMinor / cost));
    if (d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best.id;
}

const PIECE = 'قطعة';

/**
 * The unit of an existing product an invoice line is in: the product's unit NAMED by the printed unit word first
 * («كرتونة» → the product's carton), else the price-based pick. When the word names a larger unit the product does
 * not have / the price cannot confirm (no cost, no price, or the price is far above the base cost), the base unit is
 * NOT taken silently: `unsure` asks the user to pick.
 */
export function pickLineUnit(units: readonly (UnitOption & { name: string })[], baseCostMinor: number, scannedUnitPriceMinor: number | null, unitWord: string | null | undefined): { unitId: string | null; unsure: boolean } {
  const std = unitFromWord(unitWord);
  if (std) {
    const want = normName(std.ar);
    const hit = units.find((u) => normName(u.name) === want);
    if (hit) return { unitId: hit.id, unsure: false };
  }
  const unitId = pickUnit(units, baseCostMinor, scannedUnitPriceMinor);
  const base = units.find((u) => u.isBase) ?? units[0];
  if (!std || normName(std.ar) === normName(PIECE) || !base || unitId !== base.id) return { unitId, unsure: false };
  // The word names a larger unit but we landed on the base unit: only trust that when the price says so.
  const priceFitsBase = !!scannedUnitPriceMinor && scannedUnitPriceMinor > 0 && baseCostMinor > 0 && scannedUnitPriceMinor < baseCostMinor * 2;
  return { unitId, unsure: !priceFitsBase };
}

/** Totals check: the scanned invoice total vs what the cart will compute. More than 1% apart = mismatch. */
export function totalsMismatch(computedMinor: number, scannedMinor: number | null): boolean {
  if (scannedMinor == null || scannedMinor <= 0) return false;
  return Math.abs(computedMinor - scannedMinor) * 100 > scannedMinor;
}
