import { describe, expect, it } from 'vitest';
import { addDays, agingBuckets, daysBetween, oldestUnpaidDay, pricePurchase, runningBalance } from '../src/purchasing';

describe('pricePurchase', () => {
  it('exclusive VAT, carton unit, base cost per piece', () => {
    // 2 cartons × 120.00, carton = 12 pieces, 14% VAT on top
    const p = pricePurchase({ lines: [{ qtyMilli: 2000, factorMilli: 12000, unitCostMinor: 12000, taxRateBp: 1400 }], pricesIncludeVat: false, vatRecoverable: true });
    expect(p.netMinor).toBe(24000);
    expect(p.taxMinor).toBe(3360);
    expect(p.totalMinor).toBe(27360);
    expect(p.lines[0]!.baseUnitCostMinor).toBe(1000); // 240.00 / 24 pieces
  });
  it('inclusive VAT splits; not VAT-registered capitalises VAT into stock', () => {
    const p = pricePurchase({ lines: [{ qtyMilli: 1000, factorMilli: 1000, unitCostMinor: 11500, taxRateBp: 1500 }], pricesIncludeVat: true, vatRecoverable: false });
    expect(p.netMinor + p.taxMinor).toBe(11500);
    expect(p.lines[0]!.baseUnitCostMinor).toBe(11500);
  });
  it('line + invoice discounts are allocated and totals add up', () => {
    const p = pricePurchase({
      lines: [
        { qtyMilli: 3000, factorMilli: 1000, unitCostMinor: 333, discountMinor: 10, taxRateBp: 0 },
        { qtyMilli: 1000, factorMilli: 1000, unitCostMinor: 1001, taxRateBp: 0 },
      ],
      pricesIncludeVat: false,
      invoiceDiscountMinor: 101,
      vatRecoverable: true,
    });
    expect(p.grossMinor).toBe(999 + 1001);
    expect(p.discountMinor).toBe(111);
    expect(p.totalMinor).toBe(2000 - 111);
    expect(p.lines.reduce((s, l) => s + l.totalMinor, 0)).toBe(p.totalMinor);
  });
  it('rejects bad lines', () => {
    expect(() => pricePurchase({ lines: [{ qtyMilli: 0, factorMilli: 1000, unitCostMinor: 1, taxRateBp: 0 }], pricesIncludeVat: false, vatRecoverable: true })).toThrow();
  });
});

describe('statement helpers', () => {
  const rows = [
    { businessDay: 20260101, at: 1, debitMinor: 1000, creditMinor: 0 },
    { businessDay: 20260201, at: 2, debitMinor: 500, creditMinor: 0 },
    { businessDay: 20260210, at: 3, debitMinor: 0, creditMinor: 1200 },
    { businessDay: 20260301, at: 4, debitMinor: 300, creditMinor: 0 },
  ];
  it('running balance', () => {
    expect(runningBalance(100, rows).map((r) => r.balanceMinor)).toEqual([1100, 1600, 400, 700]);
  });
  it('oldest unpaid day is FIFO', () => {
    // balance 600 = 300 (Mar) + 300 of Feb invoice
    expect(oldestUnpaidDay(rows)).toBe(20260201);
    expect(oldestUnpaidDay([{ businessDay: 1, at: 1, debitMinor: 5, creditMinor: 5 }])).toBeNull();
  });
  it('aging buckets', () => {
    expect(agingBuckets(rows, 20260315)).toEqual([300, 300, 0, 0]);
    expect(daysBetween(20260101, 20260301)).toBe(59);
    expect(addDays(20261231, 1)).toBe(20270101);
  });
});
