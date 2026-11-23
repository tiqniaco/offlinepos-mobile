/**
 * Pure helpers for adding products fast (invoice scan, photographed list, scan-and-add):
 * - default sale price = cost × (1 + markup), rounded UP to the shop's step (0.25 / 0.50 / 1.00 EGP);
 * - unit words read from an invoice or a list (كرتونه / ctn / كجم …) → one of the standard units;
 * - a cleaned product name from what the photo said;
 * - a fuzzy look-alike among existing products (duplicate guard: «تقصد X؟» instead of creating a twin).
 */
import { normalizeArabicForSearch } from '@daftarak/shared';

/** Arabic-normalised, punctuation-free, single-spaced (أ/إ/آ → ا, ة → ه, ى → ي, tashkeel removed, digits Latin). */
export function normName(s: string): string {
  return normalizeArabicForSearch(s)
    .replace(/[^\u0621-\u064Aa-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const DEFAULT_MARKUP_BP = 2000;
export const DEFAULT_PRICE_ROUNDING_MINOR = 50;
export const PRICE_ROUNDING_STEPS = [0, 25, 50, 100] as const;
export type PriceRounding = (typeof PRICE_ROUNDING_STEPS)[number];

export interface QuickPricing {
  markupBp: number;
  stepMinor: number;
}

/** The shop's pricing defaults from its settings (missing → 20 % and 0.50). */
export function pricingOf(s: { defaultMarkupBp?: number | null; priceRoundingMinor?: number | null }): QuickPricing {
  const m = s.defaultMarkupBp;
  const r = s.priceRoundingMinor;
  return {
    markupBp: m != null && Number.isSafeInteger(m) && m >= 0 && m <= 100_000 ? m : DEFAULT_MARKUP_BP,
    stepMinor: r != null && (PRICE_ROUNDING_STEPS as readonly number[]).includes(r) ? r : DEFAULT_PRICE_ROUNDING_MINOR,
  };
}

/** Rounds a price UP to the step (0 = as is). Never rounds a positive price down to 0. */
export function roundSalePrice(minor: number, stepMinor: number): number {
  if (!(minor > 0)) return 0;
  if (!(stepMinor > 0)) return Math.round(minor);
  return Math.ceil(Math.round(minor) / stepMinor) * stepMinor;
}

/** Sale price from cost: cost × (1 + markup), rounded up to the step. Cost 0 / unknown → null (the user types it). */
export function markupPrice(costMinor: number | null | undefined, p: QuickPricing): number | null {
  if (costMinor == null || !(costMinor > 0)) return null;
  return roundSalePrice((costMinor * (10_000 + p.markupBp)) / 10_000, p.stepMinor);
}

// ───────────── units ─────────────

export interface UnitWord {
  /** The standard unit's Arabic name (as seeded) — matched / created by this name. */
  ar: string;
  en: string;
  fraction: boolean;
}

const UNIT_WORDS: (UnitWord & { words: string[] })[] = [
  { ar: 'قطعة', en: 'Piece', fraction: false, words: ['قطعة', 'قطعه', 'قطع', 'حبة', 'حبه', 'حبات', 'عدد', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units'] },
  { ar: 'علبة', en: 'Box', fraction: false, words: ['علبة', 'علبه', 'علب', 'box', 'boxes'] },
  { ar: 'كرتونة', en: 'Carton', fraction: false, words: ['كرتونة', 'كرتونه', 'كرتون', 'كراتين', 'كرتونات', 'ctn', 'ctns', 'carton', 'cartons'] },
  { ar: 'كيس', en: 'Bag', fraction: false, words: ['كيس', 'اكياس', 'bag', 'bags'] },
  { ar: 'زجاجة', en: 'Bottle', fraction: false, words: ['زجاجة', 'زجاجه', 'زجاجات', 'ازازة', 'ازازه', 'قزازة', 'قزازه', 'bottle', 'bottles', 'btl'] },
  { ar: 'كيلو', en: 'Kg', fraction: true, words: ['كيلو', 'كيلوجرام', 'كيلو جرام', 'كجم', 'كغ', 'كغم', 'kg', 'kgs', 'kilo', 'kilos'] },
  { ar: 'جرام', en: 'Gram', fraction: true, words: ['جرام', 'جرامات', 'جم', 'غرام', 'غ', 'gm', 'gram', 'grams'] },
  { ar: 'لتر', en: 'Litre', fraction: true, words: ['لتر', 'ليتر', 'لترات', 'l', 'lt', 'ltr', 'litre', 'liter'] },
  { ar: 'دستة', en: 'Dozen', fraction: false, words: ['دستة', 'دسته', 'دست', 'dz', 'dzn', 'dozen'] },
  { ar: 'باكو', en: 'Pack', fraction: false, words: ['باكو', 'باكت', 'باكيت', 'بكت', 'pack', 'packs', 'pk', 'pkt'] },
  { ar: 'شكارة', en: 'Sack', fraction: false, words: ['شكارة', 'شكاره', 'جوال', 'جوالات', 'sack'] },
  { ar: 'لفة', en: 'Roll', fraction: false, words: ['لفة', 'لفه', 'رول', 'roll', 'rolls'] },
  { ar: 'متر', en: 'Metre', fraction: true, words: ['متر', 'مترات', 'امتار', 'meter', 'metre', 'mtr'] },
  { ar: 'برطمان', en: 'Jar', fraction: false, words: ['برطمان', 'برطمانات', 'jar', 'jars'] },
];
const BY_WORD = new Map<string, UnitWord>();
for (const u of UNIT_WORDS) for (const w of u.words) BY_WORD.set(normName(w), { ar: u.ar, en: u.en, fraction: u.fraction });

/** The standard unit a written unit word means (كرتونه / ctn → كرتونة); null when it is not a known unit word. */
export function unitFromWord(word: string | null | undefined): UnitWord | null {
  if (!word) return null;
  const n = normName(word);
  return n ? (BY_WORD.get(n) ?? null) : null;
}

/** Units offered on a new line (the chip row): the common ones, in this order. */
export const QUICK_UNITS = ['قطعة', 'علبة', 'كرتونة', 'كيس', 'زجاجة', 'كيلو', 'لتر', 'دستة'] as const;

// ───────────── names ─────────────

const isNumber = (w: string) => /^[\d.,/]+$/.test(w);

/**
 * Cleans a name read from a photo: no line number in front («1- »، «2) »), no stray punctuation at the ends, single
 * spaces. A trailing unit word («شاي العروسة كرتونة») is split off as the unit — unless a number comes before it
 * («سكر 1 كيلو» is a 1-kilo pack: the size stays in the name).
 */
export function splitNameUnit(raw: string): { name: string; unit: UnitWord | null } {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^\(?\d{1,3}\s*[-).:]\s*/, ''); // «1- » «2) » «3. »
  s = s.replace(/^[\s\-–—*•·.,:;|#_]+|[\s\-–—*•·,:;|#_]+$/g, '').trim();
  const words = s.split(' ');
  if (words.length >= 2) {
    const last = unitFromWord(words[words.length - 1]!);
    const prev = words[words.length - 2]!;
    if (last && !isNumber(prev)) return { name: words.slice(0, -1).join(' '), unit: last };
  }
  return { name: s, unit: null };
}

// ───────────── duplicate guard ─────────────

/** Levenshtein distance, early-exit above `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

/** 0..1 similarity of two names (normalised; spaces ignored so «شاي العروسه» ≈ «شاى العروسة»). */
export function nameSimilarity(a: string, b: string): number {
  const x = normName(a).replace(/ /g, '');
  const y = normName(b).replace(/ /g, '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  const len = Math.max(x.length, y.length);
  const max = Math.floor(len * 0.35);
  const d = editDistance(x, y, max);
  return d > max ? 0 : 1 - d / len;
}

export interface FuzzyIndex<T extends { id: string; name: string }> {
  find(name: string, threshold?: number): T | null;
}

/**
 * Index of existing names for the duplicate guard: candidates share a word prefix (first 3 letters of a word of 3+
 * letters), then the closest by edit distance wins if it is at least `threshold` similar (default 0.8). Cheap enough
 * for thousands of products × 100 lines.
 */
export function fuzzyIndex<T extends { id: string; name: string }>(items: readonly T[]): FuzzyIndex<T> {
  const buckets = new Map<string, T[]>();
  const keys = (s: string) => [...new Set(normName(s).split(' ').filter((w) => w.length >= 3).map((w) => w.slice(0, 3)))];
  for (const it of items) for (const k of keys(it.name)) (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(it);
  return {
    find(name, threshold = 0.8) {
      const seen = new Set<string>();
      let best: { it: T; s: number } | null = null;
      for (const k of keys(name)) {
        for (const it of buckets.get(k) ?? []) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          const s = nameSimilarity(name, it.name);
          if (s >= threshold && (!best || s > best.s)) best = { it, s };
        }
      }
      return best?.it ?? null;
    },
  };
}
