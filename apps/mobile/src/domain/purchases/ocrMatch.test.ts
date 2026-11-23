import { buildReview, matchByName, normName, toMilli, toMinor, unitCostMinor } from './ocrMatch';

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
    expect(toMilli(0)).toBe(1000);
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
    expect(r[0]).toMatchObject({ product: { id: 'p2' }, match: 'exact', qtyMilli: 10_000, costMinor: 3000, skip: false });
    expect(r[1]).toMatchObject({ product: null, match: null, qtyMilli: 2000, costMinor: 2500 });
  });
});
