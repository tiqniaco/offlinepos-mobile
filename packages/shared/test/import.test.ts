import { describe, expect, it } from 'vitest';
import { guessMapping, validateImportRows, IMPORT_TEMPLATE_AR } from '../src/productImport';

describe('column auto-mapping', () => {
  it('maps the Arabic template headers', () => {
    const m = guessMapping(IMPORT_TEMPLATE_AR.headers);
    expect(m).toMatchObject({ name: 0, barcode: 1, sku: 2, category: 3, unit: 4, cost: 5, retail_price: 6, wholesale_price: 7, qty: 8, low_stock: 9, larger_unit: 10, larger_factor: 11, larger_price: 12, larger_barcode: 13 });
  });
  it('maps common English headers regardless of case/spacing', () => {
    expect(guessMapping(['Product Name', 'Barcode', 'Selling Price', 'Cost Price', 'Qty'])).toEqual({ name: 0, barcode: 1, retail_price: 2, cost: 3, qty: 4 });
  });
});

describe('row validation', () => {
  const map = guessMapping(IMPORT_TEMPLATE_AR.headers);
  it('parses the template example', () => {
    const r = validateImportRows([IMPORT_TEMPLATE_AR.example], map);
    expect(r.errors).toEqual([]);
    expect(r.valid[0]).toMatchObject({ rowNumber: 2, name: 'شاي العروسة 250 جم', costMinor: 1850, retailMinor: 2200, qtyMilli: 48_000, largerFactorMilli: 24_000, largerPriceMinor: 50_000 });
  });
  it('reports row-level errors with sheet row numbers', () => {
    const rows = [
      ['', '111'],
      ['زيت', '222', '', '', '', 'abc'],
      ['أرز', '222'],
      ['سكر', '', '', '', '', '', '-5'],
    ];
    const r = validateImportRows(rows, map);
    expect(r.errors).toEqual([
      { rowNumber: 2, field: 'name', code: 'name_required' },
      { rowNumber: 3, field: 'cost', code: 'bad_money' },
      { rowNumber: 5, field: 'retail_price', code: 'negative' },
    ]);
    expect(r.valid.map((v) => v.name)).toEqual(['أرز']);
  });
  it('flags duplicate barcodes inside the file', () => {
    const r = validateImportRows([['أ', '999'], ['ب', '999']], map);
    expect(r.errors).toEqual([{ rowNumber: 3, field: 'barcode', code: 'duplicate_barcode_in_file' }]);
  });
  it('accepts Arabic digits and comma thousands', () => {
    const r = validateImportRows([['شاي', '', '', '', '', '١٢٫٥', '1,250.75']], map);
    expect(r.valid[0]).toMatchObject({ costMinor: 1250, retailMinor: 125_075 });
  });
  it('accepts currency marks', () => {
    expect(validateImportRows([['شاي', '', '', '', '', '15 ج.م', '20 ريال']], map).valid[0]).toMatchObject({ costMinor: 1500, retailMinor: 2000 });
  });
  it('skips fully empty rows', () => {
    expect(validateImportRows([[null, '', ' ']], map).skippedEmpty).toBe(1);
  });
  it('requires both larger unit and factor (> 1)', () => {
    const r = validateImportRows([['شاي', '', '', '', '', '', '', '', '', '', 'كرتونة']], map);
    expect(r.errors[0]).toMatchObject({ code: 'larger_unit_incomplete' });
  });
});
