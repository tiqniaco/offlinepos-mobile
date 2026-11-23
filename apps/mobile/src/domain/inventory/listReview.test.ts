import { buildListReview, listProblems, listToStockItems } from './listReview';

const pricing = { markupBp: 2000, stepMinor: 50 };
const shop = [
  { id: 'p1', name: 'شاي العروسة' },
  { id: 'p2', name: 'بسكويت شمعدان' },
];

describe('photographed item list → review rows', () => {
  const rows = buildListReview(
    [
      { name: 'شاى العروسه', qty: 24, unit: null, cost: 18, price: null },
      { name: 'زيت عافية كرتونة', qty: 3, unit: null, cost: 400, price: null },
      { name: 'صابون لوكس', qty: 12, unit: 'قطعه', cost: null, price: 15 },
      { name: 'رز', qty: 10, unit: 'كجم', cost: null, price: null },
      { name: 'بسكوت شمعدان', qty: 5, unit: null, cost: null, price: null },
    ],
    shop,
    { autoCreate: true, pricing },
  );
  it('matches existing items, creates the rest with unit / price from the list or the markup', () => {
    expect(rows[0]).toMatchObject({ product: { id: 'p1' }, match: 'exact', qtyMilli: 24_000, costMinor: 1800 });
    expect(rows[1]).toMatchObject({ match: 'create', name: 'زيت عافية', unit: 'كرتونة', costMinor: 40_000, saleMinor: 48_000, saleFrom: 'markup' });
    expect(rows[2]).toMatchObject({ match: 'create', unit: 'قطعة', costMinor: null, saleMinor: 1500, saleFrom: 'list' });
    expect(rows[3]).toMatchObject({ match: 'create', unit: 'كيلو', saleMinor: null });
    expect(rows[4]).toMatchObject({ match: null, suggestion: { id: 'p2' } }); // duplicate guard
  });
  it('a new item needs a sale price unless «سيب السعر بعدين»', () => {
    expect(listProblems(rows[3]!)).toEqual(['price']);
    expect(listProblems({ ...rows[3]!, priceLater: true })).toEqual([]);
    expect(listProblems(rows[4]!)).toEqual(['product']);
  });
  it('ready rows → stock items; review mark when cost is missing, price guessed or left for later', () => {
    const items = listToStockItems([...rows.slice(0, 3), { ...rows[3]!, priceLater: true }, { ...rows[4]!, skip: true }]);
    expect(items).toEqual([
      { productId: 'p1', qtyMilli: 24_000, costMinor: 1800 },
      { create: { name: 'زيت عافية', unit: 'كرتونة', costMinor: 40_000, retailPriceMinor: 48_000, needsPriceReview: true }, qtyMilli: 3000 },
      { create: { name: 'صابون لوكس', unit: 'قطعة', costMinor: 0, retailPriceMinor: 1500, needsPriceReview: true }, qtyMilli: 12_000 },
      { create: { name: 'رز', unit: 'كيلو', costMinor: 0, retailPriceMinor: 0, needsPriceReview: true }, qtyMilli: 10_000 },
    ]);
    const typed = listToStockItems([{ ...rows[1]!, saleMinor: 50_000, saleFrom: 'typed' }]);
    expect(typed[0]!.create!.needsPriceReview).toBe(false);
  });
});
