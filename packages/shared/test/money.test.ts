import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate, divRound, formatMinor, lineAmount, mulDivRound, parseMinor, parseQtyMilli, formatQty, splitInclusive, taxExclusive, MoneyError } from '../src/money';

describe('divRound (the one rounding function)', () => {
  it.each([
    [5, 2, 3], [-5, 2, -3], [4, 3, 1], [5, 3, 2], [-4, 3, -1], [1, 2, 1], [-1, 2, -1], [0, 7, 0], [7, -2, -4],
  ])('divRound(%i, %i) = %i', (n, d, r) => expect(divRound(n, d)).toBe(r));
  it('rejects floats and zero', () => {
    expect(() => divRound(1.5, 2)).toThrow(MoneyError);
    expect(() => divRound(1, 0)).toThrow(MoneyError);
  });
  it('is within 0.5 of the exact quotient', () => {
    fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e12 }), fc.integer({ min: 1, max: 1e6 }), (n, d) => {
      expect(Math.abs(divRound(n, d) - n / d)).toBeLessThanOrEqual(0.5 + 1e-9);
    }));
  });
});

describe('mulDivRound', () => {
  it('uses BigInt for huge intermediates exactly', () => {
    expect(mulDivRound(9_000_000_000_000, 1000, 1000)).toBe(9_000_000_000_000);
  });
});

describe('line & tax math', () => {
  it('line amount with milli quantities', () => {
    expect(lineAmount(1250, 2000)).toBe(2500); // 12.50 × 2
    expect(lineAmount(999, 1500)).toBe(1499); // 9.99 × 1.5 = 14.985 → 14.99 (half away from zero)
    expect(lineAmount(333, 333)).toBe(111); // 3.33 × 0.333 = 1.10889
  });
  it('VAT-inclusive split: net + tax = gross', () => {
    expect(splitInclusive(11500, 1500)).toEqual({ net: 10000, tax: 1500 });
    expect(splitInclusive(11400, 1400)).toEqual({ net: 10000, tax: 1400 });
    fc.assert(fc.property(fc.integer({ min: 0, max: 1e10 }), fc.integer({ min: 0, max: 3000 }), (g, r) => {
      const { net, tax } = splitInclusive(g, r);
      expect(net + tax).toBe(g);
      expect(tax).toBeGreaterThanOrEqual(0);
    }));
  });
  it('VAT-exclusive', () => {
    expect(taxExclusive(10000, 1500)).toBe(1500);
    expect(taxExclusive(333, 1400)).toBe(47); // 46.62 → 47
  });
});

describe('allocate (largest remainder)', () => {
  it('sums exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(10, [0, 0])).toEqual([10, 0]);
    fc.assert(fc.property(fc.integer({ min: -1e9, max: 1e9 }), fc.array(fc.integer({ min: 0, max: 1e7 }), { minLength: 1, maxLength: 40 }), (t, w) => {
      const a = allocate(t, w);
      expect(a.reduce((x, y) => x + y, 0)).toBe(t);
      expect(a).toHaveLength(w.length);
    }));
  });
});

describe('format & parse', () => {
  it('formats minor units', () => {
    expect(formatMinor(123456)).toBe('1,234.56');
    expect(formatMinor(-5)).toBe('-0.05');
    expect(formatMinor(100, { grouping: false })).toBe('1.00');
  });
  it('parses user input', () => {
    expect(parseMinor('12')).toBe(1200);
    expect(parseMinor('12.5')).toBe(1250);
    expect(parseMinor('1,234.56')).toBe(123456);
    expect(parseMinor('1.234')).toBeNull();
    expect(parseMinor('abc')).toBeNull();
  });
  it('parses & formats quantities', () => {
    expect(parseQtyMilli('2')).toBe(2000);
    expect(parseQtyMilli('1.25')).toBe(1250);
    expect(parseQtyMilli('1.5', false)).toBeNull();
    expect(formatQty(1250)).toBe('1.25');
    expect(formatQty(3000)).toBe('3');
  });
  it('round-trips', () => {
    fc.assert(fc.property(fc.integer({ min: -1e12, max: 1e12 }), (m) => {
      expect(parseMinor(formatMinor(m))).toBe(m);
    }));
  });
});
