/**
 * Supplier-invoice scan (OCR) → purchase lines. Pure helpers: match the names read from the photo to the shop's own
 * products / suppliers, and convert the model's major-unit numbers into the app's minor units / milli-quantities.
 */
import { normalizeArabicForSearch, type OcrLine } from '@daftarak/shared';

export interface NamedItem {
  id: string;
  name: string;
}
export type MatchKind = 'exact' | 'contains';
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
 * Best match for `name` among `items`: an exact normalised name first; otherwise a name that contains the other
 * (either way), preferring the closest length. Short names (< 3 chars) never match by containment.
 */
export function matchByName<T extends NamedItem>(name: string, items: readonly T[]): NameMatch<T> | null {
  const q = normName(name);
  if (!q) return null;
  let best: { item: T; score: number } | null = null;
  for (const it of items) {
    const n = normName(it.name);
    if (!n) continue;
    if (n === q) return { item: it, kind: 'exact' };
    if (n.length < MIN_CONTAINS || q.length < MIN_CONTAINS) continue;
    if (` ${q} `.includes(` ${n} `) || ` ${n} `.includes(` ${q} `) || q.includes(n) || n.includes(q)) {
      // Word-boundary containment ranks above a raw substring; then the closest length wins.
      const word = ` ${q} `.includes(` ${n} `) || ` ${n} `.includes(` ${q} `) ? 0 : 1000;
      const score = word + Math.abs(n.length - q.length);
      if (!best || score < best.score) best = { item: it, score };
    }
  }
  return best ? { item: best.item, kind: 'contains' } : null;
}

/** Major units (e.g. 12.5 EGP) → minor units (1250); null / invalid → null. */
export function toMinor(v: number | null | undefined): number | null {
  return v == null || !Number.isFinite(v) || v < 0 ? null : Math.round(v * 100);
}

/** Quantity → milli-units (1.5 → 1500), at least 1 (0.001). */
export function toMilli(q: number | null | undefined): number {
  return q == null || !Number.isFinite(q) || q <= 0 ? 1000 : Math.max(1, Math.round(q * 1000));
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
  match: MatchKind | 'picked' | 'new' | null;
  qtyMilli: number;
  /** Unit cost in minor units (per base unit). */
  costMinor: number | null;
  skip: boolean;
}

/** One review line per invoice line, auto-matched to the shop's products. */
export function buildReview<P extends NamedItem>(lines: readonly OcrLine[], products: readonly P[]): ReviewLine<P>[] {
  return lines.map((l, i) => {
    const m = matchByName(l.name, products);
    return { key: `ocr-${i}`, read: l.name, product: m?.item ?? null, match: m?.kind ?? null, qtyMilli: toMilli(l.qty), costMinor: unitCostMinor(l), skip: false };
  });
}
