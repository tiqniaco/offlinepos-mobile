/**
 * Purchase invoice math (SPEC §5 Purchases) and account-statement helpers (كشف حساب).
 * Pure functions shared by the app and tests. Money in minor units, qty in milli-units, rates in bp.
 */
import { allocate, assertInt, divRound, lineAmount, mulDivRound, splitInclusive, taxExclusive } from './money';

export interface PurchaseLineInput {
  qtyMilli: number;
  /** Units per base unit × 1000 (e.g. carton of 12 = 12000). */
  factorMilli: number;
  /** Price per purchase unit as on the supplier's invoice. */
  unitCostMinor: number;
  discountMinor?: number;
  taxRateBp: number;
}

export interface PricedPurchaseLine {
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  /** Net cost of ONE base unit (excl. VAT) after line + invoice discounts — goes to the stock ledger. */
  baseUnitCostMinor: number;
}

export interface PricedPurchase {
  lines: PricedPurchaseLine[];
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Price a purchase. `pricesIncludeVat` = the supplier's prices include VAT. `vatRecoverable` = the shop is
 * VAT-registered; if not, VAT is part of the cost (no input-VAT line, tax shown but capitalised into stock).
 */
export function pricePurchase(input: { lines: PurchaseLineInput[]; pricesIncludeVat: boolean; invoiceDiscountMinor?: number; vatRecoverable: boolean }): PricedPurchase {
  const lines = input.lines;
  for (const l of lines) {
    assertInt(l.qtyMilli, 'qty');
    assertInt(l.unitCostMinor, 'cost');
    if (l.qtyMilli <= 0 || l.unitCostMinor < 0 || l.factorMilli <= 0) throw new RangeError('invalid purchase line');
  }
  const gross = lines.map((l) => lineAmount(l.unitCostMinor, l.qtyMilli));
  const lineDisc = lines.map((l, i) => Math.min(Math.max(0, l.discountMinor ?? 0), gross[i]!));
  const afterLine = gross.map((g, i) => g - lineDisc[i]!);
  const invDisc = Math.min(Math.max(0, input.invoiceDiscountMinor ?? 0), afterLine.reduce((s, v) => s + v, 0));
  const alloc = allocate(invDisc, afterLine);
  const out: PricedPurchaseLine[] = lines.map((l, i) => {
    const amount = afterLine[i]! - alloc[i]!;
    let net: number;
    let tax: number;
    if (input.pricesIncludeVat) ({ net, tax } = splitInclusive(amount, l.taxRateBp));
    else {
      net = amount;
      tax = taxExclusive(amount, l.taxRateBp);
    }
    const stockValue = input.vatRecoverable ? net : net + tax;
    const baseQty = mulDivRound(l.qtyMilli, l.factorMilli, 1000);
    return {
      grossMinor: gross[i]!,
      discountMinor: lineDisc[i]! + alloc[i]!,
      netMinor: net,
      taxMinor: tax,
      totalMinor: net + tax,
      baseUnitCostMinor: baseQty > 0 ? divRound(stockValue * 1000, baseQty) : 0,
    };
  });
  const sum = (k: keyof PricedPurchaseLine) => out.reduce((s, l) => s + l[k], 0);
  return { lines: out, grossMinor: sum('grossMinor'), discountMinor: sum('discountMinor'), netMinor: sum('netMinor'), taxMinor: sum('taxMinor'), totalMinor: sum('totalMinor') };
}

// ─────────────────────────── statements & aging ───────────────────────────

export interface LedgerRow {
  businessDay: number;
  at: number;
  debitMinor: number;
  creditMinor: number;
}

/** Running balance (debit − credit) starting from `opening`. */
export function runningBalance<T extends LedgerRow>(opening: number, rows: readonly T[]): (T & { balanceMinor: number })[] {
  let b = opening;
  return rows.map((r) => {
    b += r.debitMinor - r.creditMinor;
    return { ...r, balanceMinor: b };
  });
}

/**
 * Oldest unpaid business day for a positive balance, FIFO: payments settle the oldest debts first, so the
 * open balance is made of the NEWEST debits. Returns null when nothing is owed.
 */
export function oldestUnpaidDay(rows: readonly LedgerRow[]): number | null {
  const balance = rows.reduce((s, r) => s + r.debitMinor - r.creditMinor, 0);
  if (balance <= 0) return null;
  let left = balance;
  const debits = rows.filter((r) => r.debitMinor > 0).sort((a, b) => b.at - a.at);
  for (const d of debits) {
    left -= d.debitMinor;
    if (left <= 0) return d.businessDay;
  }
  return debits.length ? debits[debits.length - 1]!.businessDay : null;
}

/** Calendar days from business day `a` to `b` (both YYYYMMDD). */
export function daysBetween(a: number, b: number): number {
  const ms = (d: number) => Date.UTC(Math.floor(d / 10000), (Math.floor(d / 100) % 100) - 1, d % 100);
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Business day (YYYYMMDD) plus n calendar days. */
export function addDays(day: number, n: number): number {
  const d = new Date(Date.UTC(Math.floor(day / 10000), (Math.floor(day / 100) % 100) - 1, day % 100) + n * 86_400_000);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Aging buckets (0–30, 31–60, 61–90, 90+ days) of an open balance, FIFO. Days are YYYYMMDD business days. */
export function agingBuckets(rows: readonly LedgerRow[], today: number): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  let left = rows.reduce((s, r) => s + r.debitMinor - r.creditMinor, 0);
  if (left <= 0) return out;
  for (const d of rows.filter((r) => r.debitMinor > 0).sort((a, b) => b.at - a.at)) {
    if (left <= 0) break;
    const take = Math.min(left, d.debitMinor);
    left -= take;
    const age = daysBetween(d.businessDay, today);
    out[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += take;
  }
  if (left > 0) out[3] += left;
  return out;
}
