import { fuzzyIndex, markupPrice, nameSimilarity, pricingOf, roundSalePrice, splitNameUnit, unitFromWord } from './quickPricing';
import { buildReview, repriceNew, reviewProblems } from '../purchases/ocrMatch';

describe('quick pricing', () => {
  it('defaults: 20 % markup, rounded up to 0.50', () => {
    expect(pricingOf({})).toEqual({ markupBp: 2000, stepMinor: 50 });
    expect(pricingOf({ defaultMarkupBp: 3500, priceRoundingMinor: 100 })).toEqual({ markupBp: 3500, stepMinor: 100 });
    expect(pricingOf({ defaultMarkupBp: -5, priceRoundingMinor: 33 })).toEqual({ markupBp: 2000, stepMinor: 50 });
  });
  it('cost × (1 + markup), rounded UP to the step', () => {
    const p = { markupBp: 2000, stepMinor: 50 };
    expect(markupPrice(1234, p)).toBe(1500); // 14.81 → 15.00
    expect(markupPrice(1000, p)).toBe(1200);
    expect(markupPrice(1000, { markupBp: 2000, stepMinor: 0 })).toBe(1200);
    expect(markupPrice(1001, { markupBp: 2000, stepMinor: 25 })).toBe(1225);
    expect(markupPrice(1001, { markupBp: 2000, stepMinor: 100 })).toBe(1300);
    expect(markupPrice(0, p)).toBeNull();
    expect(markupPrice(null, p)).toBeNull();
    expect(roundSalePrice(1, 50)).toBe(50);
  });
});

describe('unit words and names', () => {
  it('maps written unit words to the standard units', () => {
    expect(unitFromWord('كرتونه')?.ar).toBe('كرتونة');
    expect(unitFromWord('CTN')?.ar).toBe('كرتونة');
    expect(unitFromWord('كجم')?.ar).toBe('كيلو');
    expect(unitFromWord('ازازة')?.ar).toBe('زجاجة');
    expect(unitFromWord('دسته')?.ar).toBe('دستة');
    expect(unitFromWord('كيس')).toMatchObject({ ar: 'كيس', en: 'Bag' });
    expect(unitFromWord('بلح')).toBeNull();
    expect(unitFromWord('')).toBeNull();
  });
  it('cleans names; a trailing unit word becomes the unit unless a size number precedes it', () => {
    expect(splitNameUnit('1- شاي العروسة  كرتونة ')).toEqual({ name: 'شاي العروسة', unit: expect.objectContaining({ ar: 'كرتونة' }) });
    expect(splitNameUnit('سكر 1 كيلو')).toEqual({ name: 'سكر 1 كيلو', unit: null });
    expect(splitNameUnit('* زيت عافية -')).toEqual({ name: 'زيت عافية', unit: null });
    expect(splitNameUnit('كيس')).toEqual({ name: 'كيس', unit: null });
  });
  it('fuzzy look-alikes for the duplicate guard', () => {
    expect(nameSimilarity('شاى العروسه', 'شاي العروسة')).toBe(1);
    expect(nameSimilarity('بسكويت شمعدان', 'بسكوت شمعدان')).toBeGreaterThan(0.8);
    const idx = fuzzyIndex([
      { id: 'a', name: 'بسكويت شمعدان' },
      { id: 'b', name: 'زيت عافية 800 مل' },
    ]);
    expect(idx.find('بسكوت شمعدان')?.id).toBe('a');
    expect(idx.find('زيت عافيه 800مل')?.id).toBe('b');
    expect(idx.find('صابون لوكس')).toBeNull();
  });
});

describe('invoice review: new products by default', () => {
  const pricing = { markupBp: 2000, stepMinor: 50 };
  const shop = [{ id: 'p1', name: 'بسكويت شمعدان' }];
  it('unmatched lines become «صنف جديد» with unit, cost and marked-up price; look-alikes are suggested instead', () => {
    const r = buildReview(
      [
        { name: 'مناديل فاين كرتونة', qty: 2, unitPrice: 123.4, total: 246.8 },
        { name: 'بسكوت شمعدان', qty: 5, unitPrice: 10, total: 50 },
        { name: 'سكر', qty: 3, unitPrice: 30, total: 90, unit: 'كيس' },
      ],
      shop,
      { autoCreate: true, pricing },
    );
    expect(r[0]).toMatchObject({ match: 'create', product: null, newItem: { name: 'مناديل فاين', unit: 'كرتونة', saleMinor: 14_850 } }); // 123.40 × 1.2 = 148.08 → 148.50
    expect(reviewProblems(r[0]!)).toEqual([]);
    // Duplicate guard: a near spelling of an existing product is NOT created — the user picks.
    expect(r[1]).toMatchObject({ match: null, newItem: null, suggestion: { id: 'p1' } });
    expect(reviewProblems(r[1]!)).toEqual(['product']);
    expect(r[2]).toMatchObject({ match: 'create', newItem: { name: 'سكر', unit: 'كيس', saleMinor: 3600 } });
    // Without the permission (autoCreate off) nothing is created.
    expect(buildReview([{ name: 'مناديل', qty: 1, unitPrice: 5, total: 5 }], shop)[0]).toMatchObject({ match: null, newItem: null });
  });
  it('bulk markup re-prices only the prices the user did not type', () => {
    const r = buildReview(
      [
        { name: 'أ صنف', qty: 1, unitPrice: 10, total: 10 },
        { name: 'ب صنف', qty: 1, unitPrice: 10, total: 10 },
      ],
      [],
      { autoCreate: true, pricing },
    );
    r[1] = { ...r[1]!, newItem: { ...r[1]!.newItem!, saleMinor: 1999, saleEdited: true } };
    const x = repriceNew(r, { markupBp: 5000, stepMinor: 50 });
    expect(x[0]!.newItem!.saleMinor).toBe(1500);
    expect(x[1]!.newItem!.saleMinor).toBe(1999);
  });
  it('a new line needs a name, qty, cost and a sale price', () => {
    const [l] = buildReview([{ name: 'شيء', qty: 0, unitPrice: 0, total: null }], [], { autoCreate: true, pricing });
    expect(reviewProblems({ ...l!, newItem: { ...l!.newItem!, name: ' ' } })).toEqual(['name', 'qty', 'price']);
  });
});
