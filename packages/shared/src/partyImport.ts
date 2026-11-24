/**
 * Excel/CSV import of customers & suppliers: column auto-mapping and row validation (pure, unit-tested).
 * Same flow as productImport: the app reads the sheet with SheetJS, passes raw cells here, shows the preview
 * with per-row errors, then saves valid rows through the normal party services (opening balance included).
 */
import { normalizePhone, type CountryCode } from './phone';
import { cellMoney, cellText, normHeader } from './productImport';

export const PARTY_IMPORT_FIELDS = ['name', 'mobile', 'address', 'email', 'tax_number', 'notes', 'credit_limit', 'opening_balance'] as const;
export type PartyImportField = (typeof PARTY_IMPORT_FIELDS)[number];

/** Fields that make sense for suppliers (no credit limit: that is a customer setting). */
export const SUPPLIER_IMPORT_FIELDS: readonly PartyImportField[] = PARTY_IMPORT_FIELDS.filter((f) => f !== 'credit_limit');

const SYNONYMS: Record<PartyImportField, string[]> = {
  name: ['name', 'customer', 'customername', 'supplier', 'suppliername', 'client', 'الاسم', 'اسمالعميل', 'العميل', 'المورد', 'اسمالمورد'],
  mobile: ['mobile', 'phone', 'tel', 'telephone', 'mobileno', 'phonenumber', 'الموبايل', 'موبايل', 'التليفون', 'تليفون', 'الهاتف', 'هاتف', 'رقمالموبايل', 'رقمالتليفون', 'الجوال', 'جوال', 'المحمول'],
  address: ['address', 'العنوان', 'عنوان'],
  email: ['email', 'mail', 'emailaddress', 'الايميل', 'الإيميل', 'البريد', 'البريدالالكتروني', 'البريدالإلكتروني'],
  tax_number: ['taxnumber', 'taxid', 'vat', 'vatnumber', 'الرقمالضريبي', 'رقمضريبي', 'البطاقةالضريبية'],
  notes: ['notes', 'note', 'comment', 'comments', 'ملاحظات', 'ملاحظة', 'ملحوظة'],
  credit_limit: ['creditlimit', 'limit', 'maxcredit', 'حدالائتمان', 'حدالآجل', 'حدالاجل', 'الحدالأقصى', 'حدالدين'],
  opening_balance: ['openingbalance', 'opening', 'balance', 'رصيدأولالمدة', 'رصيداولالمدة', 'رصيدافتتاحي', 'الرصيد', 'رصيد', 'الرصيدالافتتاحي'],
};

/** Guess mapping field → column index from the header row. Each column is used at most once. */
export function guessPartyMapping(headers: readonly unknown[], fields: readonly PartyImportField[] = PARTY_IMPORT_FIELDS): Partial<Record<PartyImportField, number>> {
  const map: Partial<Record<PartyImportField, number>> = {};
  const used = new Set<number>();
  const norm = headers.map(normHeader);
  for (const f of fields) {
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== '' && SYNONYMS[f].includes(h));
    if (idx >= 0) {
      map[f] = idx;
      used.add(idx);
    }
  }
  return map;
}

export interface PartyImportRow {
  rowNumber: number;
  name: string;
  /** Normalised E.164 without "+" (same as the party form saves). */
  mobile: string | null;
  address: string | null;
  email: string | null;
  taxNumber: string | null;
  notes: string | null;
  creditLimitMinor: number | null;
  /** Signed: > 0 the normal side (customer owes us / we owe the supplier), < 0 the other way. */
  openingMinor: number | null;
}

export type PartyImportErrorCode = 'name_required' | 'name_too_long' | 'bad_phone' | 'duplicate_phone_in_file' | 'bad_email' | 'bad_money' | 'negative';

export interface PartyImportError {
  rowNumber: number;
  field: PartyImportField;
  code: PartyImportErrorCode;
}

export function validatePartyRows(
  rows: readonly (readonly unknown[])[],
  mapping: Partial<Record<PartyImportField, number>>,
  opts: { country?: CountryCode; firstDataRowNumber?: number } = {},
): { valid: PartyImportRow[]; errors: PartyImportError[]; skippedEmpty: number } {
  const country = opts.country ?? 'EG';
  const first = opts.firstDataRowNumber ?? 2;
  const valid: PartyImportRow[] = [];
  const errors: PartyImportError[] = [];
  const seenPhones = new Set<string>();
  let skippedEmpty = 0;
  rows.forEach((cells, i) => {
    const rowNumber = first + i;
    const get = (f: PartyImportField) => (mapping[f] == null ? null : cells[mapping[f]!]);
    if (cells.every((c) => c == null || String(c).trim() === '')) {
      skippedEmpty++;
      return;
    }
    const rowErrors: PartyImportError[] = [];
    const err = (field: PartyImportField, code: PartyImportErrorCode) => rowErrors.push({ rowNumber, field, code });

    const name = cellText(get('name'));
    if (!name) err('name', 'name_required');
    else if (name.length > 120) err('name', 'name_too_long');

    const rawPhone = cellText(get('mobile'));
    // Same rule as the party form: international first, then the shop's country.
    const mobile = rawPhone ? (normalizePhone(rawPhone) ?? normalizePhone(rawPhone, country)) : null;
    if (rawPhone && !mobile) err('mobile', 'bad_phone');
    else if (mobile && seenPhones.has(mobile)) err('mobile', 'duplicate_phone_in_file');

    const email = cellText(get('email'));
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err('email', 'bad_email');

    const credit = cellMoney(get('credit_limit'));
    if (credit === 'bad') err('credit_limit', 'bad_money');
    else if (credit != null && credit < 0) err('credit_limit', 'negative');

    const opening = cellMoney(get('opening_balance'));
    if (opening === 'bad') err('opening_balance', 'bad_money');

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    if (mobile) seenPhones.add(mobile);
    valid.push({
      rowNumber,
      name: name!,
      mobile,
      address: cellText(get('address')),
      email,
      taxNumber: cellText(get('tax_number')),
      notes: cellText(get('notes')),
      creditLimitMinor: credit === 'bad' ? null : credit,
      openingMinor: opening === 'bad' || !opening ? null : opening,
    });
  });
  return { valid, errors, skippedEmpty };
}

/** Header row + one example row for the downloadable template (Arabic headers). */
export function partyImportTemplateAr(type: 'C' | 'S'): { headers: string[]; example: (string | number)[] } {
  return type === 'C'
    ? {
        headers: ['الاسم', 'الموبايل', 'العنوان', 'الإيميل', 'الرقم الضريبي', 'ملاحظات', 'حد الآجل', 'رصيد أول المدة'],
        example: ['محمود علي', '01012345678', 'شارع الجمهورية - المنصورة', '', '', 'بيشتري جملة', 2000, 350],
      }
    : {
        headers: ['الاسم', 'الموبايل', 'العنوان', 'الإيميل', 'الرقم الضريبي', 'ملاحظات', 'رصيد أول المدة'],
        example: ['شركة النور للتوزيع', '01112345678', 'العبور', '', '', 'بيورد كل خميس', 1500],
      };
}

// ─────────────────────────── one-column name lists (expense categories…) ───────────────────────────

const NAME_HEADERS = ['name', 'category', 'الاسم', 'القسم', 'البند', 'التصنيف', 'نوعالمصروف', 'المصروف'];

/**
 * A sheet with one name per row (first row = headers if it looks like one). Returns the unique names in
 * file order, minus `existing` (compared without spaces/case), and how many were skipped.
 */
export function validateNameRows(
  rows: readonly (readonly unknown[])[],
  existing: readonly string[] = [],
  maxLength = 60,
): { names: string[]; existing: number; duplicates: number; tooLong: number[] } {
  if (!rows.length) return { names: [], existing: 0, duplicates: 0, tooLong: [] };
  const head = rows[0]!.map(normHeader);
  let col = head.findIndex((h) => NAME_HEADERS.includes(h));
  const hasHeader = col >= 0;
  if (!hasHeader) col = 0;
  const key = (s: string) => normHeader(s);
  const have = new Set(existing.map(key));
  const seen = new Set<string>();
  const out = { names: [] as string[], existing: 0, duplicates: 0, tooLong: [] as number[] };
  rows.slice(hasHeader ? 1 : 0).forEach((cells, i) => {
    const name = cellText(cells[col]);
    if (!name) return;
    const rowNumber = i + (hasHeader ? 2 : 1);
    if (name.length > maxLength) return void out.tooLong.push(rowNumber);
    const k = key(name);
    if (have.has(k)) return void out.existing++;
    if (seen.has(k)) return void out.duplicates++;
    seen.add(k);
    out.names.push(name);
  });
  return out;
}
