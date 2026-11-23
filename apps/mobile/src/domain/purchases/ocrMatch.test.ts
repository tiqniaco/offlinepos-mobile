import { buildReview, matchByName, normName, pickUnit, reviewProblems, toMilli, toMinor, totalsMismatch, unitCostMinor } from './ocrMatch';

const products = [
  { id: 'p1', name: 'سكر' },
  { id: 'p2', name: 'سكر الأسرة 1 كيلو' },
  { id: 'p3', name: 'زيت عباد الشمس 800 مل' },
  { id: 'p4', name: 'شاي العروسة' },
  { id: 'p5', name: 'مكرونة' },
];

describe('OCR name matching', () => {
  it('normalises Arabic spelling, tashkeel and digits', () => {
    expect(normName('  إِسْكَنْدَرِيَّة ١٢٣ ')).toBe('اسكندريه 123');
    expect(normName('شاى-العروسة')).toBe('شاي العروسه');
  });
  it('exact normalised match wins', () => {
    expect(matchByName('سُكَّر الاسرة ١ كيلو', products)).toEqual({ item: products[1], kind: 'exact' });
    expect(matchByName('شاى العروسة', products)).toEqual({ item: products[3], kind: 'exact' });
  });
  it('falls back to containment (word boundary first, closest length)', () => {
    expect(matchByName('زيت عباد الشمس', products)).toEqual({ item: products[2], kind: 'contains' });
    expect(matchByName('مكرونة اسباجتي', products)).toEqual({ item: products[4], kind: 'contains' });
    expect(matchByName('سكر ناعم', products)?.item.id).toBe('p1');
  });
  it('a raw substring is only a "partial" match (never pre-selected)', () => {
    expect(matchByName('سكري', [{ id: 'x', name: 'سكرية للشاي' }])).toEqual({ item: { id: 'x', name: 'سكرية للشاي' }, kind: 'partial' });
    const r = buildReview([{ name: 'سكري', qty: 1, unitPrice: 5, total: 5 }], [{ id: 'x', name: 'سكرية للشاي' }]);
    expect(r[0]).toMatchObject({ product: null, match: null, suggestion: { id: 'x' } });
    expect(reviewProblems(r[0]!)).toEqual(['product']);
  });
  it('picks the unit whose cost is closest to the printed price', () => {
    const units = [{ id: 'pc', factorMilli: 1000, isBase: true }, { id: 'ctn', factorMilli: 24_000, isBase: false }];
    expect(pickUnit(units, 1800, 43_200)).toBe('ctn');
    expect(pickUnit(units, 1800, 1900)).toBe('pc');
    expect(pickUnit(units, 0, 43_200)).toBe('pc');
    expect(totalsMismatch(10_100, 10_000)).toBe(false);
    expect(totalsMismatch(10_200, 10_000)).toBe(true);
  });
  it('no match for unknown or too-short names', () => {
    expect(matchByName('بن محوج', products)).toBeNull();
    expect(matchByName('', products)).toBeNull();
    expect(matchByName('سك', [{ id: 'x', name: 'سكر' }])).toBeNull();
  });
  it('converts money and quantities', () => {
    expect(toMinor(12.5)).toBe(1250);
    expect(toMinor(null)).toBeNull();
    expect(toMinor(-1)).toBeNull();
    expect(toMilli(1.5)).toBe(1500);
    expect(toMilli(0)).toBe(0); // not read → the user must type it (never a silent 1)
    expect(toMilli(null)).toBe(0);
    expect(unitCostMinor({ qty: 4, unitPrice: null, total: 100 })).toBe(2500);
    expect(unitCostMinor({ qty: 4, unitPrice: 30, total: 100 })).toBe(3000);
  });
  it('builds review lines', () => {
    const r = buildReview(
      [
        { name: 'سكر الاسرة 1 كيلو', qty: 10, unitPrice: 30, total: 300 },
        { name: 'بن', qty: 2, unitPrice: null, total: 50 },
      ],
      products,
    );
    expect(r[0]).toMatchObject({ product: { id: 'p2' }, match: 'exact', qtyMilli: 10_000, costMinor: 3000, totalMinor: 30_000, costFromTotal: false, unitId: null, skip: false });
    expect(r[1]).toMatchObject({ product: null, match: null, qtyMilli: 2000, costMinor: 2500, costFromTotal: true });
  });
});
