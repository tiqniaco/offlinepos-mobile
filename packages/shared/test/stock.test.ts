import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyMovement, EMPTY_LEVEL, replayLedger, toBaseQty, splitByUnit, gs1CheckDigit, isValidGtin, internalBarcode, normalizeBarcode } from '../src/stock';

describe('moving average cost', () => {
  it('first purchase sets the average', () => {
    const r = applyMovement(EMPTY_LEVEL, { qtyMilli: 10_000, unitCostMinor: 500 });
    expect(r.level).toEqual({ qtyMilli: 10_000, avgCostMinor: 500, valueMinor: 5000 });
  });
  it('second purchase averages by quantity', () => {
    let l = applyMovement(EMPTY_LEVEL, { qtyMilli: 10_000, unitCostMinor: 500 }).level; // 10 @ 5.00
    l = applyMovement(l, { qtyMilli: 30_000, unitCostMinor: 700 }).level; // 30 @ 7.00
    expect(l.avgCostMinor).toBe(650); // (50 + 210) / 40 = 6.50
    expect(l.valueMinor).toBe(26_000);
  });
  it('sales keep the average and are valued at it', () => {
    let l = applyMovement(EMPTY_LEVEL, { qtyMilli: 10_000, unitCostMinor: 500 }).level;
    const sale = applyMovement(l, { qtyMilli: -4_000, unitCostMinor: null });
    expect(sale.unitCostMinor).toBe(500);
    expect(sale.level).toEqual({ qtyMilli: 6_000, avgCostMinor: 500, valueMinor: 3000 });
  });
  it('resets the average when stock was zero or negative', () => {
    let l = applyMovement(EMPTY_LEVEL, { qtyMilli: -2_000, unitCostMinor: null }, 300).level; // oversold
    l = applyMovement(l, { qtyMilli: 5_000, unitCostMinor: 800 }).level;
    expect(l.avgCostMinor).toBe(800);
    expect(l.qtyMilli).toBe(3_000);
  });
  it('adjustments without cost use the product cost when there is no average yet', () => {
    const r = applyMovement(EMPTY_LEVEL, { qtyMilli: 5_000, unitCostMinor: null }, 250);
    expect(r.unitCostMinor).toBe(250);
    expect(r.level.valueMinor).toBe(1250);
  });
  it('fractional quantities (weighed goods)', () => {
    const l = applyMovement(EMPTY_LEVEL, { qtyMilli: 1_250, unitCostMinor: 8000 }).level; // 1.25 kg @ 80.00
    expect(l.valueMinor).toBe(10_000);
  });
  it('replay of any movement stream gives integer, consistent results', () => {
    const mv = fc.record({ qtyMilli: fc.integer({ min: -50_000, max: 50_000 }), unitCostMinor: fc.option(fc.integer({ min: 0, max: 1_000_000 }), { nil: null }) });
    fc.assert(
      fc.property(fc.array(mv, { maxLength: 60 }), (stream) => {
        const a = replayLedger(stream);
        let b = EMPTY_LEVEL;
        for (const m of stream) b = applyMovement(b, m).level;
        expect(a).toEqual(b);
        expect(a.qtyMilli).toBe(stream.reduce((s, m) => s + m.qtyMilli, 0));
        expect(Number.isSafeInteger(a.valueMinor)).toBe(true);
      }),
    );
  });
});

describe('units', () => {
  it('converts to base quantity', () => {
    expect(toBaseQty(2_000, 24_000)).toBe(48_000); // 2 cartons × 24
    expect(toBaseQty(500, 12_000)).toBe(6_000); // half a dozen
  });
  it('splits into larger units', () => {
    expect(splitByUnit(50_000, 24_000)).toEqual({ units: 2, remainderMilli: 2_000 });
    expect(splitByUnit(-50_000, 24_000)).toEqual({ units: -2, remainderMilli: -2_000 });
    expect(splitByUnit(0, 24_000)).toEqual({ units: 0, remainderMilli: 0 });
  });
});

describe('barcodes', () => {
  it('computes GS1 check digits', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
  });
  it('generates valid in-store EAN-13 codes starting with 2', () => {
    const c = internalBarcode(1, 42);
    expect(c).toMatch(/^2\d{12}$/);
    expect(isValidGtin(c)).toBe(true);
    expect(internalBarcode(1, 43)).not.toBe(c);
  });
  it('normalises scanner input', () => {
    expect(normalizeBarcode(' ٦٢٢١٢٣ 4567890\n')).toBe('6221234567890');
  });
});
