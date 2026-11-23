/**
 * Supplier-invoice scan (OCR) → purchase lines. Pure helpers: match the names read from the photo to the shop's own
 * products / suppliers, and convert the model's major-unit numbers into the app's minor units / milli-quantities.
 */
import { normalizeArabicForSearch, type OcrLine } from '@daftarak/shared';

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

/** Arabic-normalised, punctuation-free, single-spaced (أ/إ/آ → ا, ة → ه, ى → ي, tashkeel removed, digits Latin). */
export function normName(s: string): string {
  return normalizeArabicForSearch(s)
    .replace(/[^\u0621-\u064Aa-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

export interface ReviewLine<P extends NamedItem = NamedItem> {
  /** Stable key for the list. */
  key: string;
  /** Name as read from the invoice. */
  read: string;
  product: P | null;
  match: MatchKind | 'picked' | 'new' | 'confirmed' | null;
  /** A raw-substring look-alike, offered but not selected. */
  suggestion?: P | null;
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
  skip: boolean;
}

/** One review line per invoice line, auto-matched to the shop's products. Only exact and whole-word matches are selected. */
export function buildReview<P extends NamedItem>(lines: readonly OcrLine[], products: readonly P[]): ReviewLine<P>[] {
  return lines.map((l, i) => {
    const m = matchByName(l.name, products);
    const sel = m && m.kind !== 'partial' ? m : null;
    return {
      key: `ocr-${i}`,
      read: l.name,
      product: sel?.item ?? null,
      match: sel?.kind ?? null,
      suggestion: m?.kind === 'partial' ? m.item : null,
      qtyMilli: toMilli(l.qty),
      costMinor: unitCostMinor(l),
      totalMinor: toMinor(l.total),
      costFromTotal: toMinor(l.unitPrice) == null && toMinor(l.total) != null,
      unitId: null,
      skip: false,
    };
  });
}

export type ReviewProblem = 'product' | 'confirm' | 'qty' | 'cost';

/** Why a (not skipped) line can't go into the purchase yet. Empty = ready. */
export function reviewProblems(l: ReviewLine): ReviewProblem[] {
  if (l.skip) return [];
  const p: ReviewProblem[] = [];
  if (!l.product) p.push('product');
  else if (l.match === 'contains') p.push('confirm');
  if (!(l.qtyMilli > 0)) p.push('qty');
  if (l.costMinor == null) p.push('cost');
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

/** Totals check: the scanned invoice total vs what the cart will compute. More than 1% apart = mismatch. */
export function totalsMismatch(computedMinor: number, scannedMinor: number | null): boolean {
  if (scannedMinor == null || scannedMinor <= 0) return false;
  return Math.abs(computedMinor - scannedMinor) * 100 > scannedMinor;
}
