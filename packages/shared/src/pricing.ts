/**
 * The pricing engine (SPEC §5: "one shared, pure pricing engine"). Same code prices the cart on the
 * phone, re-prices it inside the posting transaction, and will run reports/tests. Offers plug in here
 * in Phase 5.
 *
 * Order of operations (PLAN.md §5):
 *   gross = unit price × qty → − line discount → − share of invoice discount (largest remainder)
 *   → VAT (inclusive: split out of the amount; exclusive: added on top) → totals = Σ rounded lines
 *   → optional cash rounding of the grand total.
 */
import { allocate, applyBp, assertInt, divRound, lineAmount, mulDivRound, splitInclusive, taxExclusive } from './money';

export type Discount = { type: 'percent'; bp: number } | { type: 'amount'; minor: number };

export interface PricingLineInput {
  key: string;
  /** Quantity in the unit being sold (milli). Negative not allowed (returns are separate documents). */
  qtyMilli: number;
  /** Price per sold unit, minor units. Inclusive of VAT when the business prices include VAT. */
  unitPriceMinor: number;
  taxRateBp: number;
  discount?: Discount | null;
  /** Automatic offer discount for this line (from applyOffers), applied BEFORE the manual discount. */
  offerDiscountMinor?: number;
  offerId?: string | null;
}

export interface PricingInput {
  lines: PricingLineInput[];
  pricesIncludeVat: boolean;
  invoiceDiscount?: Discount | null;
  /** Coupon amount (from applyOffers), applied after line offers and before the manual invoice discount. */
  couponMinor?: number;
  /** Round the grand total to this step (e.g. 25 = 0.25). 0/undefined = no cash rounding. */
  cashRoundingMinor?: number;
}

export interface PricedLine {
  key: string;
  qtyMilli: number;
  unitPriceMinor: number;
  taxRateBp: number;
  grossMinor: number;
  /** Automatic offer discount (not counted in role caps). */
  offerDiscountMinor: number;
  offerId: string | null;
  /** Manual line discount (counted in role caps). */
  lineDiscountMinor: number;
  /** Share of coupon + manual invoice discount. */
  invoiceDiscountMinor: number;
  /** Amount after all discounts, as priced (incl. VAT if pricesIncludeVat). */
  amountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface PricedCart {
  lines: PricedLine[];
  grossMinor: number;
  offerDiscountMinor: number;
  lineDiscountMinor: number;
  couponMinor: number;
  /** Manual invoice discount only (the coupon is separate). */
  invoiceDiscountMinor: number;
  netMinor: number;
  taxMinor: number;
  /** Σ line totals before cash rounding. */
  totalBeforeRoundingMinor: number;
  roundingMinor: number;
  totalMinor: number;
  /** Tax breakdown per rate (for receipts / ZATCA). */
  taxByRate: { rateBp: number; netMinor: number; taxMinor: number }[];
}

export class PricingError extends Error {
  constructor(
    public readonly code: 'negative_qty' | 'negative_price' | 'discount_too_large' | 'bad_discount',
    public readonly lineKey?: string,
  ) {
    super(code);
    this.name = 'PricingError';
  }
}

function discountAmount(base: number, d: Discount | null | undefined, lineKey?: string): number {
  if (!d) return 0;
  if (d.type === 'percent') {
    if (!Number.isSafeInteger(d.bp) || d.bp < 0 || d.bp > 10_000) throw new PricingError('bad_discount', lineKey);
    return applyBp(base, d.bp);
  }
  assertInt(d.minor, 'discount');
  if (d.minor < 0) throw new PricingError('bad_discount', lineKey);
  if (d.minor > base) throw new PricingError('discount_too_large', lineKey);
  return d.minor;
}

export function priceCart(input: PricingInput): PricedCart {
  const pre = input.lines.map((l) => {
    assertInt(l.qtyMilli, 'qty');
    assertInt(l.unitPriceMinor, 'price');
    if (l.qtyMilli < 0) throw new PricingError('negative_qty', l.key);
    if (l.unitPriceMinor < 0) throw new PricingError('negative_price', l.key);
    const gross = lineAmount(l.unitPriceMinor, l.qtyMilli);
    const offer = l.offerDiscountMinor ?? 0;
    assertInt(offer, 'offer');
    if (offer < 0 || offer > gross) throw new PricingError('bad_discount', l.key);
    const lineDiscount = discountAmount(gross - offer, l.discount, l.key);
    return { l, gross, offer, lineDiscount, after: gross - offer - lineDiscount };
  });

  const afterTotal = pre.reduce((s, x) => s + x.after, 0);
  const coupon = Math.min(Math.max(0, input.couponMinor ?? 0), afterTotal);
  assertInt(coupon, 'coupon');
  const invoiceDiscount = discountAmount(afterTotal - coupon, input.invoiceDiscount);
  const shares = allocate(coupon + invoiceDiscount, pre.map((x) => x.after));

  const lines: PricedLine[] = pre.map((x, i) => {
    const amount = x.after - shares[i]!;
    let net: number;
    let tax: number;
    if (input.pricesIncludeVat) {
      ({ net, tax } = splitInclusive(amount, x.l.taxRateBp));
    } else {
      net = amount;
      tax = taxExclusive(amount, x.l.taxRateBp);
    }
    return {
      key: x.l.key,
      qtyMilli: x.l.qtyMilli,
      unitPriceMinor: x.l.unitPriceMinor,
      taxRateBp: x.l.taxRateBp,
      grossMinor: x.gross,
      offerDiscountMinor: x.offer,
      offerId: x.offer > 0 ? (x.l.offerId ?? null) : null,
      lineDiscountMinor: x.lineDiscount,
      invoiceDiscountMinor: shares[i]!,
      amountMinor: amount,
      netMinor: net,
      taxMinor: tax,
      totalMinor: net + tax,
    };
  });

  const sum = (f: (l: PricedLine) => number) => lines.reduce((s, l) => s + f(l), 0);
  const totalBefore = sum((l) => l.totalMinor);
  const step = input.cashRoundingMinor ?? 0;
  const rounded = step > 0 ? divRound(totalBefore, step) * step : totalBefore;
  const byRate = new Map<number, { rateBp: number; netMinor: number; taxMinor: number }>();
  for (const l of lines) {
    const r = byRate.get(l.taxRateBp) ?? { rateBp: l.taxRateBp, netMinor: 0, taxMinor: 0 };
    r.netMinor += l.netMinor;
    r.taxMinor += l.taxMinor;
    byRate.set(l.taxRateBp, r);
  }
  return {
    lines,
    grossMinor: sum((l) => l.grossMinor),
    offerDiscountMinor: sum((l) => l.offerDiscountMinor),
    lineDiscountMinor: sum((l) => l.lineDiscountMinor),
    couponMinor: coupon,
    invoiceDiscountMinor: invoiceDiscount,
    netMinor: sum((l) => l.netMinor),
    taxMinor: sum((l) => l.taxMinor),
    totalBeforeRoundingMinor: totalBefore,
    roundingMinor: rounded - totalBefore,
    totalMinor: rounded,
    taxByRate: [...byRate.values()].sort((a, b) => a.rateBp - b.rateBp),
  };
}

/** Effective discount of a line or the invoice in basis points (for role caps). */
export function effectiveBp(discountMinor: number, baseMinor: number): number {
  if (baseMinor <= 0 || discountMinor <= 0) return 0;
  // Round UP so a cap can't be bypassed by rounding.
  return Math.ceil((discountMinor * 10_000) / baseMinor);
}

export interface DiscountCaps {
  maxItemDiscountBp: number;
  maxInvoiceDiscountBp: number;
}

export interface CapViolation {
  kind: 'item' | 'invoice';
  key?: string;
  bp: number;
  maxBp: number;
}

/** Which discounts exceed the user's role caps (SPEC §5). Empty = allowed. */
export function discountViolations(cart: PricedCart, caps: DiscountCaps): CapViolation[] {
  const out: CapViolation[] = [];
  for (const l of cart.lines) {
    const bp = effectiveBp(l.lineDiscountMinor, l.grossMinor - l.offerDiscountMinor);
    if (bp > caps.maxItemDiscountBp) out.push({ kind: 'item', key: l.key, bp, maxBp: caps.maxItemDiscountBp });
  }
  const base = cart.grossMinor - cart.offerDiscountMinor - cart.lineDiscountMinor - cart.couponMinor;
  const ibp = effectiveBp(cart.invoiceDiscountMinor, base);
  if (ibp > caps.maxInvoiceDiscountBp) out.push({ kind: 'invoice', bp: ibp, maxBp: caps.maxInvoiceDiscountBp });
  return out;
}

// ───────────────────────── payments ─────────────────────────

export const PAYMENT_METHODS = ['cash', 'card', 'wallet', 'bank', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PaymentInput {
  method: PaymentMethod;
  amountMinor: number;
  /** For wallets: "Vodafone Cash", "STC Pay"…; for cards/bank: optional reference. */
  label?: string | null;
}

export interface Settlement {
  /** What is applied to the invoice per method (cash reduced by the change). */
  applied: PaymentInput[];
  paidMinor: number;
  creditMinor: number;
  changeMinor: number;
  cashTenderedMinor: number;
}

export class PaymentError extends Error {
  constructor(public readonly code: 'underpaid' | 'overpaid_non_cash' | 'credit_requires_customer' | 'negative' | 'nothing_to_pay') {
    super(code);
    this.name = 'PaymentError';
  }
}

/**
 * Validate a (possibly split) payment. Only cash may exceed the total (the excess is change).
 * Credit (آجل) needs a customer and becomes receivable.
 */
export function settle(totalMinor: number, payments: PaymentInput[], hasCustomer: boolean): Settlement {
  assertInt(totalMinor, 'total');
  for (const p of payments) {
    assertInt(p.amountMinor, 'payment');
    if (p.amountMinor < 0) throw new PaymentError('negative');
  }
  const ps = payments.filter((p) => p.amountMinor > 0);
  if (totalMinor > 0 && ps.length === 0) throw new PaymentError('underpaid');
  if (ps.some((p) => p.method === 'credit') && !hasCustomer) throw new PaymentError('credit_requires_customer');
  const sum = ps.reduce((s, p) => s + p.amountMinor, 0);
  if (sum < totalMinor) throw new PaymentError('underpaid');
  const nonCash = ps.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amountMinor, 0);
  if (nonCash > totalMinor) throw new PaymentError('overpaid_non_cash');
  const cashTendered = ps.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amountMinor, 0);
  const change = sum - totalMinor;
  // Apply the change against cash (cash lines in order).
  let remainingChange = change;
  const applied = ps.map((p) => {
    if (p.method !== 'cash' || remainingChange === 0) return { ...p };
    const take = Math.min(p.amountMinor, remainingChange);
    remainingChange -= take;
    return { ...p, amountMinor: p.amountMinor - take };
  }).filter((p) => p.amountMinor > 0);
  const credit = applied.filter((p) => p.method === 'credit').reduce((s, p) => s + p.amountMinor, 0);
  return { applied, paidMinor: totalMinor - credit, creditMinor: credit, changeMinor: change, cashTenderedMinor: cashTendered };
}

// ───────────────────────── returns ─────────────────────────

export interface LineAmounts {
  qtyMilli: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Amounts refunded when returning `qtyMilli` of an original line, given what was already returned.
 * Proportional, and the LAST return of a line takes exactly the remainder (no rounding drift).
 */
export function returnAmounts(original: LineAmounts, alreadyReturned: LineAmounts, qtyMilli: number): LineAmounts {
  const remainingQty = original.qtyMilli - alreadyReturned.qtyMilli;
  if (qtyMilli <= 0 || qtyMilli > remainingQty) throw new Error('return quantity exceeds what is left');
  if (qtyMilli === remainingQty) {
    return {
      qtyMilli,
      netMinor: original.netMinor - alreadyReturned.netMinor,
      taxMinor: original.taxMinor - alreadyReturned.taxMinor,
      totalMinor: original.totalMinor - alreadyReturned.totalMinor,
    };
  }
  const total = mulDivRound(original.totalMinor, qtyMilli, original.qtyMilli);
  const tax = mulDivRound(original.taxMinor, qtyMilli, original.qtyMilli);
  return { qtyMilli, netMinor: total - tax, taxMinor: tax, totalMinor: total };
}
