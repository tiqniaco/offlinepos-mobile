import { describe, expect, it } from 'vitest';
import { guessPartyMapping, partyImportTemplateAr, SUPPLIER_IMPORT_FIELDS, validateNameRows, validatePartyRows } from '../src/partyImport';

describe('party column auto-mapping', () => {
  it('maps the Arabic customer template headers', () => {
    expect(guessPartyMapping(partyImportTemplateAr('C').headers)).toEqual({ name: 0, mobile: 1, address: 2, email: 3, tax_number: 4, notes: 5, credit_limit: 6, opening_balance: 7 });
  });
  it('maps the supplier template without a credit limit', () => {
    const m = guessPartyMapping(partyImportTemplateAr('S').headers, SUPPLIER_IMPORT_FIELDS);
    expect(m).toEqual({ name: 0, mobile: 1, address: 2, email: 3, tax_number: 4, notes: 5, opening_balance: 6 });
  });
  it('maps common English and colloquial headers', () => {
    expect(guessPartyMapping(['Customer Name', 'Phone', 'Address', 'Opening Balance'])).toEqual({ name: 0, mobile: 1, address: 2, opening_balance: 3 });
    expect(guessPartyMapping(['اسم العميل', 'رقم الموبايل', 'ملحوظة'])).toEqual({ name: 0, mobile: 1, notes: 2 });
  });
});

describe('party row validation', () => {
  const map = guessPartyMapping(partyImportTemplateAr('C').headers);
  it('parses the template example and normalises the phone', () => {
    const r = validatePartyRows([partyImportTemplateAr('C').example], map);
    expect(r.errors).toEqual([]);
    expect(r.valid[0]).toMatchObject({ rowNumber: 2, name: 'محمود علي', mobile: '201012345678', creditLimitMinor: 200_000, openingMinor: 35_000, email: null });
  });
  it('accepts a phone that Excel turned into a number (leading zero lost) and Arabic digits', () => {
    const r = validatePartyRows([['أ', 1012345678], ['ب', '٠١١٢٣٤٥٦٧٨٩']], map);
    expect(r.errors).toEqual([]);
    expect(r.valid.map((x) => x.mobile)).toEqual(['201012345678', '201123456789']);
  });
  it('reports per-row errors with sheet row numbers', () => {
    const rows = [
      ['', '01012345678'],
      ['سارة', '12345'],
      ['منى', '01012345678'],
      ['هبة', '1012345678'],
      ['علي', '', '', 'not-an-email'],
      ['حسن', '', '', '', '', '', '-5'],
      ['كريم', '', '', '', '', '', '', 'abc'],
      [null, null],
      ['ياسر', '', '', '', '', '', '', '-120.5'],
    ];
    const r = validatePartyRows(rows, map);
    expect(r.errors).toEqual([
      { rowNumber: 2, field: 'name', code: 'name_required' },
      { rowNumber: 3, field: 'mobile', code: 'bad_phone' },
      { rowNumber: 5, field: 'mobile', code: 'duplicate_phone_in_file' },
      { rowNumber: 6, field: 'email', code: 'bad_email' },
      { rowNumber: 7, field: 'credit_limit', code: 'negative' },
      { rowNumber: 8, field: 'opening_balance', code: 'bad_money' },
    ]);
    expect(r.skippedEmpty).toBe(1);
    expect(r.valid.map((v) => v.name)).toEqual(['منى', 'ياسر']);
    // A negative opening balance is allowed: it is the other side (we owe the customer).
    expect(r.valid[1]!.openingMinor).toBe(-12_050);
  });
  it('leaves a zero opening balance out', () => {
    const r = validatePartyRows([['أ', '', '', '', '', '', '', 0]], map);
    expect(r.valid[0]!.openingMinor).toBeNull();
  });
});

describe('name lists (expense categories)', () => {
  it('uses the header column, skips existing and repeated names', () => {
    const r = validateNameRows([['ملاحظة', 'البند'], ['', 'إيجار'], ['', 'كهربا'], ['', ' كهربا '], ['', 'ايجار '], ['', null]], ['ايجار']);
    expect(r).toEqual({ names: ['إيجار', 'كهربا'], existing: 1, duplicates: 1, tooLong: [] });
  });
  it('without a header reads the first column from row 1', () => {
    const r = validateNameRows([['مواصلات'], ['x'.repeat(61)], ['صيانة']]);
    expect(r.names).toEqual(['مواصلات', 'صيانة']);
    expect(r.tooLong).toEqual([2]);
  });
});
