import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { priceCart, discountViolations, effectiveBp, settle, returnAmounts, PricingError, PaymentError, type PricingLineInput } from '../src/pricing';
import { zatcaTlvBase64, zatcaTimestamp } from '../src/zatca';
import { buildReceiptBytes, floydSteinberg, packBits, rasterCommands, rgbaToGray, threshold, chunkBytes } from '../src/escpos';

const line = (over: Partial<PricingLineInput> = {}): PricingLineInput => ({ key: 'a', qtyMilli: 1000, unitPriceMinor: 1150, taxRateBp: 1500, ...over });

describe('pricing — VAT inclusive (shops)', () => {
  it('splits VAT out of the shelf price', () => {
    const c = priceCart({ lines: [line()], pricesIncludeVat: true });
    expect(c.lines[0]).toMatchObject({ grossMinor: 1150, netMinor: 1000, taxMinor: 150, totalMinor: 1150 });
    expect(c.totalMinor).toBe(1150);
  });
  it('multiplies by milli quantities and units', () => {
    const c = priceCart({ lines: [line({ qtyMilli: 2500, unitPriceMinor: 8000, taxRateBp: 0 })], pricesIncludeVat: true });
    expect(c.totalMinor).toBe(20_000); // 2.5 kg × 80.00
  });
  it('item percent + invoice amount discounts', () => {
    const c = priceCart({
      lines: [line({ key: 'a', unitPriceMinor: 2000, qtyMilli: 3000, discount: { type: 'percent', bp: 1000 } }), line({ key: 'b', unitPriceMinor: 1000 })],
      pricesIncludeVat: true,
      invoiceDiscount: { type: 'amount', minor: 300 },
    });
    expect(c.grossMinor).toBe(7000);
    expect(c.lineDiscountMinor).toBe(600);
    expect(c.invoiceDiscountMinor).toBe(300);
    expect(c.lines.map((l) => l.invoiceDiscountMinor)).toEqual([253, 47]); // pro rata 5400 : 1000 → 253.1 / 46.9, largest remainder
    expect(c.totalMinor).toBe(6100);
    expect(c.netMinor + c.taxMinor).toBe(c.totalMinor);
  });
});

describe('pricing — VAT exclusive (trading)', () => {
  it('adds VAT on top, rounded per line', () => {
    const c = priceCart({ lines: [line({ unitPriceMinor: 333, taxRateBp: 1400 }), line({ key: 'b', unitPriceMinor: 333, taxRateBp: 1400 })], pricesIncludeVat: false });
    expect(c.lines[0]).toMatchObject({ netMinor: 333, taxMinor: 47, totalMinor: 380 });
    expect(c.taxMinor).toBe(94);
    expect(c.totalMinor).toBe(760);
    expect(c.taxByRate).toEqual([{ rateBp: 1400, netMinor: 666, taxMinor: 94 }]);
  });
  it('mixed tax rates are reported separately', () => {
    const c = priceCart({ lines: [line({ taxRateBp: 0 }), line({ key: 'b', taxRateBp: 1500 })], pricesIncludeVat: false });
    expect(c.taxByRate.map((r) => r.rateBp)).toEqual([0, 1500]);
  });
});

describe('pricing — cash rounding', () => {
  it('rounds the grand total to the step and records the difference', () => {
    const c = priceCart({ lines: [line({ unitPriceMinor: 1013, taxRateBp: 0 })], pricesIncludeVat: true, cashRoundingMinor: 25 });
    expect(c.totalBeforeRoundingMinor).toBe(1013);
    expect(c.totalMinor).toBe(1025); // 10.13 → nearest 0.25 = 10.25
    expect(c.roundingMinor).toBe(c.totalMinor - 1013);
  });
});

describe('pricing — invariants (property tests)', () => {
  const arbLine = fc.record({
    key: fc.string({ minLength: 1, maxLength: 4 }),
    qtyMilli: fc.integer({ min: 0, max: 100_000 }),
    unitPriceMinor: fc.integer({ min: 0, max: 1_000_000 }),
    taxRateBp: fc.constantFrom(0, 500, 1400, 1500),
    discount: fc.option(fc.record({ type: fc.constant('percent' as const), bp: fc.integer({ min: 0, max: 10_000 }) }), { nil: null }),
  });
  it('totals always equal Σ lines; net + tax = total; nothing negative', () => {
    fc.assert(
      fc.property(fc.array(arbLine, { minLength: 1, maxLength: 12 }), fc.boolean(), fc.integer({ min: 0, max: 10_000 }), (lines, incl, invBp) => {
        const c = priceCart({ lines, pricesIncludeVat: incl, invoiceDiscount: { type: 'percent', bp: invBp } });
        expect(c.totalMinor).toBe(c.lines.reduce((s, l) => s + l.totalMinor, 0));
        expect(c.netMinor + c.taxMinor).toBe(c.totalBeforeRoundingMinor);
        expect(c.lines.reduce((s, l) => s + l.invoiceDiscountMinor, 0)).toBe(c.invoiceDiscountMinor);
        for (const l of c.lines) {
          expect(l.amountMinor).toBeGreaterThanOrEqual(0);
          expect(l.taxMinor).toBeGreaterThanOrEqual(0);
          expect(l.netMinor + l.taxMinor).toBe(l.totalMinor);
        }
      }),
    );
  });
  it('the same cart always prices the same (deterministic)', () => {
    fc.assert(fc.property(fc.array(arbLine, { minLength: 1, maxLength: 8 }), (lines) => {
      expect(priceCart({ lines, pricesIncludeVat: true })).toEqual(priceCart({ lines, pricesIncludeVat: true }));
    }));
  });
});

describe('pricing — errors', () => {
  it('rejects negative quantities/prices and over-large discounts', () => {
    expect(() => priceCart({ lines: [line({ qtyMilli: -1 })], pricesIncludeVat: true })).toThrow(PricingError);
    expect(() => priceCart({ lines: [line({ unitPriceMinor: -1 })], pricesIncludeVat: true })).toThrow(PricingError);
    expect(() => priceCart({ lines: [line({ discount: { type: 'amount', minor: 99_999 } })], pricesIncludeVat: true })).toThrow('discount_too_large');
    expect(() => priceCart({ lines: [line({ discount: { type: 'percent', bp: 10_001 } })], pricesIncludeVat: true })).toThrow('bad_discount');
  });
});

describe('discount caps per role', () => {
  it('flags discounts above the role limit (rounded up, no bypass by rounding)', () => {
    const c = priceCart({ lines: [line({ unitPriceMinor: 1000, discount: { type: 'amount', minor: 51 } })], pricesIncludeVat: true });
    expect(effectiveBp(51, 1000)).toBe(510);
    expect(discountViolations(c, { maxItemDiscountBp: 500, maxInvoiceDiscountBp: 500 })).toEqual([{ kind: 'item', key: 'a', bp: 510, maxBp: 500 }]);
    expect(discountViolations(c, { maxItemDiscountBp: 600, maxInvoiceDiscountBp: 500 })).toEqual([]);
  });
  it('invoice discount cap', () => {
    const c = priceCart({ lines: [line({ unitPriceMinor: 10_000 })], pricesIncludeVat: true, invoiceDiscount: { type: 'percent', bp: 2000 } });
    expect(discountViolations(c, { maxItemDiscountBp: 0, maxInvoiceDiscountBp: 1000 })).toEqual([{ kind: 'invoice', bp: 2000, maxBp: 1000 }]);
  });
});

describe('payments', () => {
  it('cash with change', () => {
    expect(settle(1150, [{ method: 'cash', amountMinor: 2000 }], false)).toMatchObject({ changeMinor: 850, paidMinor: 1150, creditMinor: 0, cashTenderedMinor: 2000, applied: [{ method: 'cash', amountMinor: 1150 }] });
  });
  it('split card + cash', () => {
    const s = settle(5000, [{ method: 'card', amountMinor: 3000 }, { method: 'cash', amountMinor: 2500 }], false);
    expect(s.changeMinor).toBe(500);
    expect(s.applied).toEqual([{ method: 'card', amountMinor: 3000 }, { method: 'cash', amountMinor: 2000 }]);
  });
  it('credit needs a customer; partial credit', () => {
    expect(() => settle(5000, [{ method: 'credit', amountMinor: 5000 }], false)).toThrow(PaymentError);
    expect(settle(5000, [{ method: 'cash', amountMinor: 2000 }, { method: 'credit', amountMinor: 3000 }], true)).toMatchObject({ paidMinor: 2000, creditMinor: 3000 });
  });
  it('rejects under-payment and over-payment by card', () => {
    expect(() => settle(5000, [{ method: 'cash', amountMinor: 4999 }], false)).toThrow('underpaid');
    expect(() => settle(5000, [{ method: 'card', amountMinor: 6000 }], false)).toThrow('overpaid_non_cash');
  });
  it('zero-total invoice needs no payment', () => {
    expect(settle(0, [], false).changeMinor).toBe(0);
  });
});

describe('returns', () => {
  const orig = { qtyMilli: 3000, netMinor: 1000, taxMinor: 150, totalMinor: 1150 };
  it('proportional, and the last return takes the exact remainder', () => {
    const r1 = returnAmounts(orig, { qtyMilli: 0, netMinor: 0, taxMinor: 0, totalMinor: 0 }, 1000);
    expect(r1).toEqual({ qtyMilli: 1000, netMinor: 333, taxMinor: 50, totalMinor: 383 });
    const r2 = returnAmounts(orig, r1, 1000);
    const done = { qtyMilli: 2000, netMinor: r1.netMinor + r2.netMinor, taxMinor: r1.taxMinor + r2.taxMinor, totalMinor: r1.totalMinor + r2.totalMinor };
    const r3 = returnAmounts(orig, done, 1000);
    expect(r1.totalMinor + r2.totalMinor + r3.totalMinor).toBe(1150);
    expect(r1.taxMinor + r2.taxMinor + r3.taxMinor).toBe(150);
  });
  it('cannot return more than sold', () => {
    expect(() => returnAmounts(orig, { qtyMilli: 2500, netMinor: 0, taxMinor: 0, totalMinor: 0 }, 1000)).toThrow();
  });
});

describe('ZATCA QR (TLV)', () => {
  it('matches the published ZATCA example', () => {
    expect(zatcaTlvBase64({ sellerName: 'Bobs Records', vatNumber: '310122393500003', timestamp: '2022-04-25T15:30:00Z', totalWithVatMinor: 100_000, vatMinor: 15_000 })).toBe(
      'AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==',
    );
  });
  it('encodes Arabic seller names as UTF-8 bytes', () => {
    const b = zatcaTlvBase64({ sellerName: 'متجر', vatNumber: '300000000000003', timestamp: zatcaTimestamp(0), totalWithVatMinor: 115, vatMinor: 15 });
    expect(b.startsWith('AQjZhdiq2KzYsQ')).toBe(true); // tag 1, length 8 (4 Arabic letters × 2 bytes)
    expect(zatcaTimestamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02T03:04:05Z');
  });
});

describe('ESC/POS raster', () => {
  it('converts RGBA to gray, transparent = white', () => {
    expect(Array.from(rgbaToGray(new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 0]), 3, 1))).toEqual([0, 255, 255]);
  });
  it('packs bits MSB-first and pads rows to whole bytes', () => {
    const bits = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 1, 1, /* row 2 */ 0, 1, 0, 0, 0, 0, 0, 0, 0]);
    expect(packBits(bits, 9, 2)).toEqual({ bytesPerRow: 2, data: new Uint8Array([0x81, 0x80, 0x40, 0x00]) });
  });
  it('emits GS v 0 bands with exact headers (golden bytes)', () => {
    const bits = new Uint8Array(16).fill(1); // 8×2 all black
    expect(Array.from(rasterCommands(bits, 8, 2))).toEqual([0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0xff, 0xff]);
    const tall = new Uint8Array(8 * 300);
    const cmd = rasterCommands(tall, 8, 300, 128);
    expect(cmd.length).toBe(3 * 8 + 300); // 3 bands × header + data
  });
  it('dithering keeps overall darkness (50% gray → ~50% black dots)', () => {
    const w = 64, h = 64;
    const out = floydSteinberg(new Uint8Array(w * h).fill(128), w, h);
    const black = out.reduce((s, v) => s + v, 0) / out.length;
    expect(black).toBeGreaterThan(0.4);
    expect(black).toBeLessThan(0.6);
    expect(Array.from(threshold(new Uint8Array([0, 159, 160, 255])))).toEqual([1, 1, 0, 0]);
  });
  it('builds a full job: init, center, raster, feed, cut, drawer', () => {
    const rgba = new Uint8Array(8 * 1 * 4).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0));
    const bytes = Array.from(buildReceiptBytes({ rgba, width: 8, height: 1, openDrawer: true }));
    expect(bytes.slice(0, 5)).toEqual([0x1b, 0x40, 0x1b, 0x61, 0x01]);
    expect(bytes.slice(-9)).toEqual([0x1d, 0x56, 0x42, 0x00, 0x1b, 0x70, 0x00, 0x19, 0xfa]);
    expect(chunkBytes(new Uint8Array(10), 4).map((c) => c.length)).toEqual([4, 4, 2]);
  });
});

it('PricingError / PaymentError are typed', () => {
  expect(new PricingError('negative_qty').code).toBe('negative_qty');
  expect(new PaymentError('underpaid').code).toBe('underpaid');
});
