import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyOffers, offerProblems, type OfferDef, type OfferLine } from '../src/offers';
import { priceCart, discountViolations } from '../src/pricing';

const DAY = 20261122;
const tea: OfferLine = { key: 'tea', productId: 'tea', categoryId: 'drinks', qtyMilli: 3000, factorMilli: 1000, unitPriceMinor: 2000 };
const teaCarton: OfferLine = { key: 'teaC', productId: 'tea', categoryId: 'drinks', qtyMilli: 1000, factorMilli: 12_000, unitPriceMinor: 22_000 };
const oil: OfferLine = { key: 'oil', productId: 'oil', categoryId: 'food', qtyMilli: 2000, factorMilli: 1000, unitPriceMinor: 8000 };
const o = (p: Partial<OfferDef> & Pick<OfferDef, 'id' | 'type'>): OfferDef => ({ name: p.id, active: true, scope: { all: true }, ...p });

describe('automatic offers', () => {
  it('percent and fixed (per base unit, min qty)', () => {
    const r = applyOffers([tea, oil], [o({ id: 'p10', type: 'PERCENT', valueBp: 1000, scope: { productIds: ['tea'] } }), o({ id: 'f5', type: 'FIXED', valueMinor: 500, minQtyMilli: 2000, scope: { categoryIds: ['food'] } })], { day: DAY });
    expect(r.lines.tea).toMatchObject({ offerId: 'p10', discountMinor: 600 });
    expect(r.lines.oil).toMatchObject({ offerId: 'f5', discountMinor: 1000 });
    const r2 = applyOffers([{ ...oil, qtyMilli: 1000 }], [o({ id: 'f5', type: 'FIXED', valueMinor: 500, minQtyMilli: 2000 })], { day: DAY });
    expect(r2.lines.oil).toBeUndefined();
  });

  it('one offer per line: the best for the customer; ties by priority then id', () => {
    const r = applyOffers([tea], [o({ id: 'a', type: 'PERCENT', valueBp: 500 }), o({ id: 'b', type: 'FIXED', valueMinor: 300 }), o({ id: 'c', type: 'PERCENT', valueBp: 1000 })], { day: DAY });
    expect(r.lines.tea!.offerId).toBe('b'); // 900 > 600 > 300
    const t = applyOffers([tea], [o({ id: 'z', type: 'PERCENT', valueBp: 1000 }), o({ id: 'y', type: 'PERCENT', valueBp: 1000, priority: 5 })], { day: DAY });
    expect(t.lines.tea!.offerId).toBe('y');
  });

  it('date range is inclusive in business days; inactive offers ignored', () => {
    const p = o({ id: 'p', type: 'PERCENT', valueBp: 1000, startsDay: 20261120, endsDay: 20261122 });
    expect(applyOffers([tea], [p], { day: 20261122 }).lines.tea).toBeDefined();
    expect(applyOffers([tea], [p], { day: 20261120 }).lines.tea).toBeDefined();
    expect(applyOffers([tea], [p], { day: 20261123 }).lines.tea).toBeUndefined();
    expect(applyOffers([tea], [p], { day: 20261119 }).lines.tea).toBeUndefined();
    expect(applyOffers([tea], [{ ...p, active: false }], { day: DAY }).lines.tea).toBeUndefined();
  });

  it('buy X get Y counts base units across units (pieces + carton)', () => {
    // buy 2 get 1 free: 3 pieces + 1 carton (12) = 15 units → 5 free, cheapest first (carton piece = 18.33 < 20)
    const r = applyOffers([tea, teaCarton], [o({ id: 'b2g1', type: 'BUY_X_GET_Y', buyQtyMilli: 2000, getQtyMilli: 1000, scope: { productIds: ['tea'] } })], { day: DAY });
    expect(r.lines.teaC!.discountMinor).toBe(Math.round((22_000 * 5) / 12));
    expect(r.lines.tea).toBeUndefined();
    const two = applyOffers([{ ...tea, qtyMilli: 2000 }], [o({ id: 'b2g1', type: 'BUY_X_GET_Y', buyQtyMilli: 2000, getQtyMilli: 1000 })], { day: DAY });
    expect(two.lines.tea).toBeUndefined(); // no complete set
  });

  it('buy X get Y of another product, half price', () => {
    const r = applyOffers([oil, { ...tea, qtyMilli: 5000 }], [o({ id: 'x', type: 'BUY_X_GET_Y', buyQtyMilli: 1000, getQtyMilli: 1000, getProductId: 'tea', valueBp: 5000, scope: { productIds: ['oil'] } })], { day: DAY });
    expect(r.lines.tea!.discountMinor).toBe(2000); // 2 oils → 2 teas at 50%
  });

  it('quantity pricing uses the best tier over all lines of the product', () => {
    const tiers = [{ minQtyMilli: 6000, unitPriceMinor: 1800 }, { minQtyMilli: 12_000, unitPriceMinor: 1700 }];
    const r = applyOffers([tea, teaCarton], [o({ id: 'q', type: 'QTY_PRICE', tiers, scope: { productIds: ['tea'] } })], { day: DAY });
    expect(r.lines.tea!.discountMinor).toBe(3 * 300);
    expect(r.lines.teaC!.discountMinor).toBe(22_000 - 12 * 1700);
    expect(applyOffers([tea], [o({ id: 'q', type: 'QTY_PRICE', tiers })], { day: DAY }).lines.tea).toBeUndefined();
  });

  it('manual price lines get no automatic offer', () => {
    expect(applyOffers([{ ...tea, priceOverridden: true }], [o({ id: 'p', type: 'PERCENT', valueBp: 1000 })], { day: DAY }).lines.tea).toBeUndefined();
  });
});

describe('coupons (after line offers)', () => {
  const c = o({ id: 'cp', type: 'COUPON', couponCode: 'EID10', valueBp: 1000, minTotalMinor: 10_000, maxUses: 2, usedCount: 0 });
  it('percent coupon on the total after line offers; code is case-insensitive', () => {
    const r = applyOffers([tea, oil], [c, o({ id: 'p', type: 'PERCENT', valueBp: 5000, scope: { productIds: ['oil'] } })], { day: DAY, couponCode: 'eid10' });
    expect(r.lines.oil!.discountMinor).toBe(8000);
    expect(r.coupon).toMatchObject({ offerId: 'cp', discountMinor: applyBp(6000 + 8000) });
    function applyBp(v: number) {
      return Math.round(v / 10);
    }
  });
  it('coupon errors: unknown, expired, not started, min total, used up, inactive', () => {
    expect(applyOffers([tea], [c], { day: DAY, couponCode: 'NOPE' }).couponError).toBe('not_found');
    expect(applyOffers([tea], [c], { day: DAY, couponCode: 'EID10' }).couponError).toBe('min_total');
    expect(applyOffers([tea, oil], [{ ...c, endsDay: DAY - 1 }], { day: DAY, couponCode: 'EID10' }).couponError).toBe('expired');
    expect(applyOffers([tea, oil], [{ ...c, startsDay: DAY + 1 }], { day: DAY, couponCode: 'EID10' }).couponError).toBe('not_started');
    expect(applyOffers([tea, oil], [{ ...c, usedCount: 2 }], { day: DAY, couponCode: 'EID10' }).couponError).toBe('used_up');
    expect(applyOffers([tea, oil], [{ ...c, active: false }], { day: DAY, couponCode: 'EID10' }).couponError).toBe('inactive');
  });
  it('amount coupon is capped at the total', () => {
    const r = applyOffers([tea], [o({ id: 'k', type: 'COUPON', couponCode: 'BIG', valueMinor: 999_999 })], { day: DAY, couponCode: 'BIG' });
    expect(r.coupon!.discountMinor).toBe(6000);
  });
});

describe('with the pricing engine: stacking and caps', () => {
  it('offer → manual line discount → coupon → manual invoice discount; offers/coupons not in role caps', () => {
    const res = applyOffers([tea, oil], [o({ id: 'p', type: 'PERCENT', valueBp: 2000 }), o({ id: 'c', type: 'COUPON', couponCode: 'X', valueMinor: 1000 })], { day: DAY, couponCode: 'X' });
    const cart = priceCart({
      pricesIncludeVat: true,
      couponMinor: res.coupon!.discountMinor,
      invoiceDiscount: { type: 'percent', bp: 500 },
      lines: [tea, oil].map((l) => ({ key: l.key, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor, taxRateBp: 1400, offerDiscountMinor: res.lines[l.key]?.discountMinor, offerId: res.lines[l.key]?.offerId, discount: l.key === 'tea' ? { type: 'percent' as const, bp: 500 } : null })),
    });
    expect(cart.offerDiscountMinor).toBe(1200 + 3200);
    expect(cart.lineDiscountMinor).toBe(Math.round(4800 * 0.05));
    expect(cart.couponMinor).toBe(1000);
    const afterLines = 6000 + 16_000 - 4400 - 240;
    expect(cart.invoiceDiscountMinor).toBe(Math.round((afterLines - 1000) * 0.05));
    expect(cart.totalMinor).toBe(afterLines - 1000 - cart.invoiceDiscountMinor);
    // 5% manual on each — a cashier with 5% caps is fine even though offers are 20%.
    expect(discountViolations(cart, { maxItemDiscountBp: 500, maxInvoiceDiscountBp: 500 })).toEqual([]);
  });

  it('property: discounts never exceed gross, totals stay consistent', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ q: fc.integer({ min: 1, max: 30 }), f: fc.constantFrom(1000, 6000, 12_000), p: fc.integer({ min: 1, max: 50_000 }), prod: fc.constantFrom('a', 'b', 'c') }), { minLength: 1, maxLength: 6 }),
        fc.array(fc.constantFrom<OfferDef>(o({ id: 'p', type: 'PERCENT', valueBp: 1500 }), o({ id: 'f', type: 'FIXED', valueMinor: 700 }), o({ id: 'b', type: 'BUY_X_GET_Y', buyQtyMilli: 2000, getQtyMilli: 1000 }), o({ id: 'q', type: 'QTY_PRICE', tiers: [{ minQtyMilli: 5000, unitPriceMinor: 100 }] }), o({ id: 'c', type: 'COUPON', couponCode: 'C', valueBp: 1000 }))),
        (raw, offers) => {
          const lines = raw.map((r, i) => ({ key: String(i), productId: r.prod, categoryId: null, qtyMilli: r.q * 1000, factorMilli: r.f, unitPriceMinor: r.p }));
          const res = applyOffers(lines, offers, { day: DAY, couponCode: 'C' });
          const cart = priceCart({ pricesIncludeVat: true, couponMinor: res.coupon?.discountMinor, lines: lines.map((l) => ({ key: l.key, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor, taxRateBp: 1400, offerDiscountMinor: res.lines[l.key]?.discountMinor })) });
          for (const l of cart.lines) {
            expect(l.offerDiscountMinor).toBeGreaterThanOrEqual(0);
            expect(l.offerDiscountMinor).toBeLessThanOrEqual(l.grossMinor);
            expect(l.totalMinor).toBeGreaterThanOrEqual(0);
          }
          expect(cart.totalMinor).toBe(cart.grossMinor - cart.offerDiscountMinor - cart.lineDiscountMinor - cart.couponMinor - cart.invoiceDiscountMinor);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('validation', () => {
  it('reports missing fields', () => {
    expect(offerProblems(o({ id: 'x', type: 'PERCENT', name: '', scope: {} }))).toEqual(['name', 'scope', 'value']);
    expect(offerProblems(o({ id: 'x', type: 'COUPON', valueBp: 100, couponCode: 'A', startsDay: 2, endsDay: 1 }))).toEqual(['dates']);
  });
});
