/**
 * Offers engine (SPEC §5 Offers, PLAN.md Q-06). Pure: given the cart lines, the active offers and the
 * business day, it returns ONE automatic offer per line (the best for the customer) and the coupon amount.
 * The result feeds priceCart (offerDiscountMinor per line, couponMinor), so the POS, the posting transaction
 * and the tests all use the same numbers.
 *
 * Stacking rules (Q-06, owner-approved):
 *   1. at most one automatic offer per line — the one that saves the customer the most (ties: priority, then id);
 *   2. the coupon applies after line offers, on the invoice;
 *   3. manual discounts come on top, within the user's role caps (offers and coupons don't count in the caps).
 * Quantities are compared in BASE units, so "buy 12 get 1" works when the customer buys a carton of 12.
 */
import { applyBp, assertInt, mulDivRound } from './money';

export const OFFER_TYPES = ['PERCENT', 'FIXED', 'BUY_X_GET_Y', 'QTY_PRICE', 'COUPON'] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export interface OfferScope {
  all?: boolean;
  productIds?: string[];
  categoryIds?: string[];
}

export interface OfferDef {
  id: string;
  name: string;
  type: OfferType;
  active: boolean;
  /** YYYYMMDD business days, inclusive; null = open-ended. */
  startsDay?: number | null;
  endsDay?: number | null;
  priority?: number;
  scope: OfferScope;
  /** PERCENT, COUPON(percent), BUY_X_GET_Y (discount on the "get" units; 10000 = free). */
  valueBp?: number | null;
  /** FIXED: amount off per BASE unit. COUPON(amount): amount off the invoice. */
  valueMinor?: number | null;
  /** PERCENT / FIXED: minimum base quantity of the line. */
  minQtyMilli?: number | null;
  /** BUY_X_GET_Y, base units. */
  buyQtyMilli?: number | null;
  getQtyMilli?: number | null;
  /** BUY_X_GET_Y: the free product (null = same pool as bought). */
  getProductId?: string | null;
  /** QTY_PRICE: price per base unit from a minimum base quantity. */
  tiers?: { minQtyMilli: number; unitPriceMinor: number }[] | null;
  /** COUPON */
  couponCode?: string | null;
  minTotalMinor?: number | null;
  maxUses?: number | null;
  usedCount?: number;
}

export interface OfferLine {
  key: string;
  productId: string;
  categoryId: string | null;
  qtyMilli: number;
  /** Base units per sold unit × 1000. */
  factorMilli: number;
  unitPriceMinor: number;
  /** Lines with a manually changed price get no automatic offer. */
  priceOverridden?: boolean;
}

export interface LineOffer {
  offerId: string;
  name: string;
  discountMinor: number;
}

export type CouponError = 'not_found' | 'inactive' | 'expired' | 'not_started' | 'min_total' | 'used_up' | 'no_items';

export interface OffersResult {
  lines: Record<string, LineOffer>;
  coupon: { offerId: string; name: string; code: string; discountMinor: number } | null;
  couponError: CouponError | null;
}

export function offerLive(o: OfferDef, day: number): boolean {
  return o.active && (!o.startsDay || day >= o.startsDay) && (!o.endsDay || day <= o.endsDay);
}

function inScope(s: OfferScope, l: OfferLine): boolean {
  if (s.all) return true;
  if (s.productIds?.includes(l.productId)) return true;
  return !!(l.categoryId && s.categoryIds?.includes(l.categoryId));
}

const baseQty = (l: OfferLine) => mulDivRound(l.qtyMilli, l.factorMilli, 1000);
const gross = (l: OfferLine) => mulDivRound(l.unitPriceMinor, l.qtyMilli, 1000);
/** Value of `units` base milli-units of this line at its price. */
const valueOfBase = (l: OfferLine, unitsMilli: number) => mulDivRound(l.unitPriceMinor, unitsMilli, l.factorMilli);

/** Discount each live automatic offer would give per line. */
function candidates(o: OfferDef, lines: OfferLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  const eligible = lines.filter((l) => !l.priceOverridden && l.qtyMilli > 0 && inScope(o.scope, l));
  switch (o.type) {
    case 'PERCENT':
      for (const l of eligible) if (baseQty(l) >= (o.minQtyMilli ?? 0)) out[l.key] = applyBp(gross(l), Math.min(10_000, o.valueBp ?? 0));
      break;
    case 'FIXED':
      for (const l of eligible) if (baseQty(l) >= (o.minQtyMilli ?? 0)) out[l.key] = Math.min(gross(l), mulDivRound(o.valueMinor ?? 0, baseQty(l), 1000));
      break;
    case 'QTY_PRICE': {
      const tiers = [...(o.tiers ?? [])].sort((a, b) => b.minQtyMilli - a.minQtyMilli);
      // Quantity counted per product across lines (a piece line + a carton line both count).
      const perProduct = new Map<string, number>();
      for (const l of eligible) perProduct.set(l.productId, (perProduct.get(l.productId) ?? 0) + baseQty(l));
      for (const l of eligible) {
        const tier = tiers.find((t) => perProduct.get(l.productId)! >= t.minQtyMilli);
        if (!tier) continue;
        const atTier = mulDivRound(tier.unitPriceMinor, baseQty(l), 1000);
        const d = gross(l) - atTier;
        if (d > 0) out[l.key] = d;
      }
      break;
    }
    case 'BUY_X_GET_Y': {
      const X = o.buyQtyMilli ?? 0;
      const Y = o.getQtyMilli ?? 0;
      if (X <= 0 || Y <= 0) break;
      const bp = Math.min(10_000, o.valueBp ?? 10_000);
      let freeUnits: number;
      let getLines: OfferLine[];
      if (o.getProductId) {
        const buyTotal = eligible.filter((l) => l.productId !== o.getProductId).reduce((s, l) => s + baseQty(l), 0);
        getLines = lines.filter((l) => l.productId === o.getProductId && !l.priceOverridden);
        const getTotal = getLines.reduce((s, l) => s + baseQty(l), 0);
        freeUnits = Math.min(Math.floor(buyTotal / X) * Y, getTotal);
      } else {
        const total = eligible.reduce((s, l) => s + baseQty(l), 0);
        // Whole sets only: buy 2 get 1 → every 3 units, 1 is free.
        freeUnits = Math.floor(total / (X + Y)) * Y;
        getLines = eligible;
      }
      // Free units go to the cheapest units first (fair to the shop, standard practice).
      const byUnitPrice = [...getLines].sort((a, b) => a.unitPriceMinor * b.factorMilli - b.unitPriceMinor * a.factorMilli);
      let left = freeUnits;
      for (const l of byUnitPrice) {
        if (left <= 0) break;
        const take = Math.min(left, baseQty(l));
        left -= take;
        out[l.key] = (out[l.key] ?? 0) + applyBp(valueOfBase(l, take), bp);
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/** Apply live offers to the cart: best automatic offer per line + optional coupon. */
export function applyOffers(lines: OfferLine[], offers: OfferDef[], opts: { day: number; couponCode?: string | null }): OffersResult {
  for (const l of lines) {
    assertInt(l.qtyMilli, 'qty');
    assertInt(l.unitPriceMinor, 'price');
  }
  const live = offers.filter((o) => o.type !== 'COUPON' && offerLive(o, opts.day));
  const best: Record<string, LineOffer & { priority: number }> = {};
  for (const o of live) {
    for (const [key, d] of Object.entries(candidates(o, lines))) {
      if (d <= 0) continue;
      const cur = best[key];
      const pr = o.priority ?? 0;
      if (!cur || d > cur.discountMinor || (d === cur.discountMinor && (pr > cur.priority || (pr === cur.priority && o.id < cur.offerId)))) {
        best[key] = { offerId: o.id, name: o.name, discountMinor: d, priority: pr };
      }
    }
  }
  const result: OffersResult = { lines: {}, coupon: null, couponError: null };
  for (const [k, v] of Object.entries(best)) result.lines[k] = { offerId: v.offerId, name: v.name, discountMinor: v.discountMinor };

  const code = opts.couponCode?.trim().toUpperCase();
  if (code) {
    const c = offers.find((o) => o.type === 'COUPON' && o.couponCode?.trim().toUpperCase() === code);
    if (!c) result.couponError = 'not_found';
    else if (!c.active) result.couponError = 'inactive';
    else if (c.startsDay && opts.day < c.startsDay) result.couponError = 'not_started';
    else if (c.endsDay && opts.day > c.endsDay) result.couponError = 'expired';
    else if (c.maxUses != null && (c.usedCount ?? 0) >= c.maxUses) result.couponError = 'used_up';
    else {
      const scoped = lines.filter((l) => inScope(c.scope, l));
      const base = scoped.reduce((s, l) => s + gross(l) - (result.lines[l.key]?.discountMinor ?? 0), 0);
      if (!scoped.length) result.couponError = 'no_items';
      else if (c.minTotalMinor && base < c.minTotalMinor) result.couponError = 'min_total';
      else {
        const d = c.valueBp ? applyBp(base, Math.min(10_000, c.valueBp)) : Math.min(base, c.valueMinor ?? 0);
        result.coupon = { offerId: c.id, name: c.name, code: c.couponCode!, discountMinor: d };
      }
    }
  }
  return result;
}

/** Validate an offer definition before saving (UI + service). */
export function offerProblems(o: OfferDef): string[] {
  const p: string[] = [];
  if (!o.name.trim()) p.push('name');
  if (o.startsDay && o.endsDay && o.endsDay < o.startsDay) p.push('dates');
  if (o.type !== 'COUPON' && !o.scope.all && !o.scope.productIds?.length && !o.scope.categoryIds?.length) p.push('scope');
  if (o.type === 'PERCENT' && !(o.valueBp && o.valueBp > 0 && o.valueBp <= 10_000)) p.push('value');
  if (o.type === 'FIXED' && !(o.valueMinor && o.valueMinor > 0)) p.push('value');
  if (o.type === 'BUY_X_GET_Y' && !((o.buyQtyMilli ?? 0) > 0 && (o.getQtyMilli ?? 0) > 0)) p.push('qty');
  if (o.type === 'QTY_PRICE' && !o.tiers?.length) p.push('tiers');
  if (o.type === 'COUPON' && !o.couponCode?.trim()) p.push('code');
  if (o.type === 'COUPON' && !(o.valueBp || o.valueMinor)) p.push('value');
  return p;
}
