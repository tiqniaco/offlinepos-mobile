/**
 * Money & quantity primitives.
 *
 * Rules (PLAN.md §5):
 * - Money is an integer number of minor units (piastres / halalas). Never a float.
 * - Quantities are integer milli-units of the base unit (1 piece = 1000, 1.25 kg = 1250).
 * - Every division goes through `divRound` (round half away from zero). This is THE rounding function.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `n` is a safe integer. Use on every value entering money math. */
export function assertInt(n: number, label = 'value'): number {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`${label} must be a safe integer, got ${n}`);
  return n;
}

/**
 * Integer division rounded half away from zero.
 * divRound(5, 2) = 3, divRound(-5, 2) = -3, divRound(4, 3) = 1.
 * Uses BigInt when the numerator is outside the safe range so we never lose precision silently.
 */
export function divRound(numerator: number, denominator: number): number {
  assertInt(denominator, 'denominator');
  if (denominator === 0) throw new MoneyError('division by zero');
  if (!Number.isSafeInteger(numerator)) throw new MoneyError(`numerator must be a safe integer, got ${numerator}`);
  const sign = (numerator < 0) !== (denominator < 0) ? -1 : 1;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor(n / d);
  const r = n - q * d;
  const result = (r * 2 >= d ? q + 1 : q) * sign;
  return result === 0 ? 0 : result; // normalise -0
}

/** Safe integer multiplication then rounded division: round(a * b / d) without float error. */
export function mulDivRound(a: number, b: number, d: number): number {
  assertInt(a, 'a');
  assertInt(b, 'b');
  assertInt(d, 'd');
  const product = a * b;
  if (Number.isSafeInteger(product)) return divRound(product, d);
  // Exact path through BigInt for very large intermediates.
  const bp = BigInt(a) * BigInt(b);
  const bd = BigInt(d);
  if (bd === 0n) throw new MoneyError('division by zero');
  const neg = (bp < 0n) !== (bd < 0n);
  const n = bp < 0n ? -bp : bp;
  const dd = bd < 0n ? -bd : bd;
  let q = n / dd;
  if ((n % dd) * 2n >= dd) q += 1n;
  const out = Number(neg ? -q : q);
  return assertInt(out, 'result');
}

export const QTY_ONE = 1000;

/** Line gross amount: unit price (minor) × quantity (milli) / 1000. */
export function lineAmount(unitPriceMinor: number, qtyMilli: number): number {
  return mulDivRound(unitPriceMinor, qtyMilli, QTY_ONE);
}

/** Percentage given in basis points (1500 = 15%). */
export function applyBp(amountMinor: number, bp: number): number {
  return mulDivRound(amountMinor, bp, 10_000);
}

/** Split a VAT-inclusive amount into net + tax. */
export function splitInclusive(grossMinor: number, rateBp: number): { net: number; tax: number } {
  const net = mulDivRound(grossMinor, 10_000, 10_000 + rateBp);
  return { net, tax: grossMinor - net };
}

/** Tax on a VAT-exclusive net amount. */
export function taxExclusive(netMinor: number, rateBp: number): number {
  return applyBp(netMinor, rateBp);
}

/**
 * Allocate `total` across `weights` proportionally with the largest-remainder method.
 * The result always sums exactly to `total`. Ties go to the earlier index (deterministic).
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  assertInt(total, 'total');
  if (weights.length === 0) return [];
  weights.forEach((w, i) => {
    assertInt(w, `weight[${i}]`);
    if (w < 0) throw new MoneyError('weights must be >= 0');
  });
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW === 0) {
    const out = weights.map(() => 0);
    out[0] = total;
    return out;
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base: number[] = [];
  const rems: { i: number; r: bigint }[] = [];
  let used = 0;
  weights.forEach((w, i) => {
    const p = BigInt(abs) * BigInt(w);
    const q = p / BigInt(sumW);
    base.push(Number(q));
    used += Number(q);
    rems.push({ i, r: p % BigInt(sumW) });
  });
  let left = abs - used;
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; k < rems.length && left > 0; k++, left--) {
    const idx = rems[k]!.i;
    base[idx] = base[idx]! + 1;
  }
  return base.map((v) => (v * sign === 0 ? 0 : v * sign));
}

export interface CurrencyInfo {
  code: 'EGP' | 'SAR';
  minorDigits: 2;
  symbolAr: string;
  symbolEn: string;
}

export const CURRENCIES: Record<CurrencyInfo['code'], CurrencyInfo> = {
  EGP: { code: 'EGP', minorDigits: 2, symbolAr: 'ج.م', symbolEn: 'EGP' },
  SAR: { code: 'SAR', minorDigits: 2, symbolAr: 'ر.س', symbolEn: 'SAR' },
};

/** Format minor units as a plain decimal string with Latin digits, e.g. 123456 → "1,234.56". */
export function formatMinor(minor: number, opts: { grouping?: boolean; minorDigits?: number } = {}): string {
  assertInt(minor, 'minor');
  const digits = opts.minorDigits ?? 2;
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const factor = 10 ** digits;
  const whole = Math.floor(abs / factor);
  const frac = abs % factor;
  let wholeStr = String(whole);
  if (opts.grouping ?? true) wholeStr = wholeStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = digits > 0 ? '.' + String(frac).padStart(digits, '0') : '';
  return (neg ? '-' : '') + wholeStr + fracStr;
}

/**
 * Parse user input (already digit-normalised) into minor units. Accepts "12", "12.5", "12.50", "1,234.5".
 * Returns null for invalid input or more decimals than the currency allows.
 */
export function parseMinor(input: string, minorDigits = 2): number | null {
  const s = input.replace(/,/g, '').trim();
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[3] ?? '';
  if (frac.length > minorDigits) return null;
  const v = Number(m[2]) * 10 ** minorDigits + Number(frac.padEnd(minorDigits, '0') || '0');
  if (!Number.isSafeInteger(v)) return null;
  return m[1] ? -v : v;
}

/** Parse a quantity string into milli-units ("2" → 2000, "1.25" → 1250). */
export function parseQtyMilli(input: string, allowFraction = true): number | null {
  const s = input.trim();
  const m = /^(\d+)(?:\.(\d{0,3}))?$/.exec(s);
  if (!m) return null;
  if (!allowFraction && m[2] && Number(m[2]) !== 0) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0');
}

export function formatQty(qtyMilli: number): string {
  assertInt(qtyMilli, 'qty');
  const neg = qtyMilli < 0;
  const abs = Math.abs(qtyMilli);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  const fracStr = frac === 0 ? '' : '.' + String(frac).padStart(3, '0').replace(/0+$/, '');
  return (neg ? '-' : '') + whole + fracStr;
}
