/**
 * Excel/CSV product import: column auto-mapping and row validation (pure, unit-tested).
 * The app reads the sheet with SheetJS, passes raw cell values here, shows the preview + row errors,
 * then commits valid rows. See docs/import-format.md.
 */
import { parseMinor } from './money';
import { normalizeDigits } from './text';
import { normalizeBarcode } from './stock';

export const IMPORT_FIELDS = [
  'name',
  'barcode',
  'sku',
  'category',
  'unit',
  'cost',
  'retail_price',
  'wholesale_price',
  'qty',
  'low_stock',
  'larger_unit',
  'larger_factor',
  'larger_price',
  'larger_barcode',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Header names we recognise (normalised: lower-case, no spaces/underscores). Arabic + English. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'productname', 'product', 'item', 'itemname', 'الاسم', 'اسمالمنتج', 'المنتج', 'الصنف', 'اسمالصنف'],
  barcode: ['barcode', 'ean', 'upc', 'code', 'الباركود', 'باركود', 'الكود'],
  sku: ['sku', 'itemcode', 'ref', 'reference', 'كودالصنف', 'رقمالصنف', 'sku'],
  category: ['category', 'group', 'القسم', 'التصنيف', 'الفئة', 'المجموعة'],
  unit: ['unit', 'uom', 'الوحدة', 'وحدة'],
  cost: ['cost', 'costprice', 'purchaseprice', 'buyprice', 'التكلفة', 'سعرالشراء', 'سعرالتكلفة'],
  retail_price: ['price', 'retailprice', 'saleprice', 'sellingprice', 'سعرالبيع', 'السعر', 'سعرالقطاعي', 'قطاعي'],
  wholesale_price: ['wholesale', 'wholesaleprice', 'سعرالجملة', 'جملة', 'الجملة'],
  qty: ['qty', 'quantity', 'stock', 'openingstock', 'الكمية', 'الرصيد', 'رصيدأول', 'المخزون'],
  low_stock: ['lowstock', 'minstock', 'reorder', 'reorderlevel', 'حدالطلب', 'الحدالادنى', 'الحدالأدنى'],
  larger_unit: ['largerunit', 'bigunit', 'packunit', 'الوحدةالكبيرة', 'وحدةكبيرة', 'العبوة'],
  larger_factor: ['factor', 'perpack', 'packsize', 'unitsperpack', 'التحويل', 'عددفيالعبوة', 'معامل'],
  larger_price: ['largerprice', 'packprice', 'سعرالعبوة', 'سعرالوحدةالكبيرة'],
  larger_barcode: ['largerbarcode', 'packbarcode', 'باركودالعبوة', 'باركودالكرتونة'],
};

function normHeader(h: unknown): string {
  return normalizeDigits(String(h ?? ''))
    .toLowerCase()
    .replace(/[\s_\-.()/]/g, '')
    .replace(/[ً-ٟـ]/g, '');
}

/** Guess mapping field → column index from the header row. Each column is used at most once. */
export function guessMapping(headers: readonly unknown[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  const norm = headers.map(normHeader);
  for (const f of IMPORT_FIELDS) {
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== '' && SYNONYMS[f].includes(h));
    if (idx >= 0) {
      map[f] = idx;
      used.add(idx);
    }
  }
  return map;
}

export interface ImportRow {
  rowNumber: number; // 1-based sheet row (header = 1)
  name: string;
  barcode: string | null;
  sku: string | null;
  category: string | null;
  unit: string | null;
  costMinor: number | null;
  retailMinor: number | null;
  wholesaleMinor: number | null;
  qtyMilli: number | null;
  lowStockMilli: number | null;
  largerUnit: string | null;
  largerFactorMilli: number | null;
  largerPriceMinor: number | null;
  largerBarcode: string | null;
}

export type ImportErrorCode =
  | 'name_required'
  | 'name_too_long'
  | 'bad_money'
  | 'bad_qty'
  | 'negative'
  | 'duplicate_barcode_in_file'
  | 'duplicate_sku_in_file'
  | 'larger_unit_incomplete';

export interface ImportError {
  rowNumber: number;
  field: ImportField;
  code: ImportErrorCode;
}

function text(v: unknown): string | null {
  if (v == null) return null;
  const s = (typeof v === 'number' ? (Number.isSafeInteger(v) ? String(v) : String(v)) : String(v)).trim();
  return s === '' ? null : s;
}

/** Excel numbers are floats: 12.5 → "12.50" before integer parsing. Strings are digit-normalised. */
function money(v: unknown): number | null | 'bad' {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? (parseMinor(v.toFixed(2)) ?? 'bad') : 'bad';
  // Allow currency marks people type in sheets; anything else non-numeric is an error, not "empty".
  const s = normalizeDigits(String(v))
    .replace(/ج\.?\s?م\.?|جنيه|ر\.?\s?س\.?|ريال|EGP|SAR|LE|\$/gi, '')
    .replace(/\s+/g, '');
  if (s === '') return null;
  return parseMinor(s) ?? 'bad';
}

function qty(v: unknown): number | null | 'bad' {
  if (v == null || v === '') return null;
  const s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(3) : 'x') : normalizeDigits(String(v)).replace(/,/g, '').trim();
  if (s === '') return null;
  const m = /^(-)?(\d+)(?:\.(\d{1,3})\d*)?$/.exec(s);
  if (!m) return 'bad';
  const v2 = Number(m[2]) * 1000 + Number((m[3] ?? '').padEnd(3, '0') || '0');
  return m[1] ? -v2 : v2;
}

export function validateImportRows(
  rows: readonly (readonly unknown[])[],
  mapping: Partial<Record<ImportField, number>>,
  firstDataRowNumber = 2,
): { valid: ImportRow[]; errors: ImportError[]; skippedEmpty: number } {
  const valid: ImportRow[] = [];
  const errors: ImportError[] = [];
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();
  let skippedEmpty = 0;
  rows.forEach((cells, i) => {
    const rowNumber = firstDataRowNumber + i;
    const get = (f: ImportField) => (mapping[f] == null ? null : cells[mapping[f]!]);
    if (cells.every((c) => c == null || String(c).trim() === '')) {
      skippedEmpty++;
      return;
    }
    const rowErrors: ImportError[] = [];
    const err = (field: ImportField, code: ImportErrorCode) => rowErrors.push({ rowNumber, field, code });

    const name = text(get('name'));
    if (!name) err('name', 'name_required');
    else if (name.length > 120) err('name', 'name_too_long');

    const moneyField = (f: ImportField) => {
      const r = money(get(f));
      if (r === 'bad') return err(f, 'bad_money'), null;
      if (r != null && r < 0) return err(f, 'negative'), null;
      return r;
    };
    const qtyField = (f: ImportField, allowNegative = false) => {
      const r = qty(get(f));
      if (r === 'bad') return err(f, 'bad_qty'), null;
      if (r != null && r < 0 && !allowNegative) return err(f, 'negative'), null;
      return r;
    };

    const costMinor = moneyField('cost');
    const retailMinor = moneyField('retail_price');
    const wholesaleMinor = moneyField('wholesale_price');
    const largerPriceMinor = moneyField('larger_price');
    const qtyMilli = qtyField('qty', true);
    const lowStockMilli = qtyField('low_stock');
    const largerFactorMilli = qtyField('larger_factor');

    const barcodeRaw = text(get('barcode'));
    const barcode = barcodeRaw ? normalizeBarcode(barcodeRaw) : null;
    const largerBarcodeRaw = text(get('larger_barcode'));
    const largerBarcode = largerBarcodeRaw ? normalizeBarcode(largerBarcodeRaw) : null;
    for (const [code, field] of [
      [barcode, 'barcode'],
      [largerBarcode, 'larger_barcode'],
    ] as const) {
      if (!code) continue;
      if (seenBarcodes.has(code)) err(field, 'duplicate_barcode_in_file');
    }
    const sku = text(get('sku'));
    if (sku && seenSkus.has(sku)) err('sku', 'duplicate_sku_in_file');

    const largerUnit = text(get('larger_unit'));
    if ((largerUnit && !largerFactorMilli) || (!largerUnit && largerFactorMilli)) err('larger_factor', 'larger_unit_incomplete');
    if (largerFactorMilli != null && largerFactorMilli <= 1000 && largerUnit) err('larger_factor', 'larger_unit_incomplete');

    if (rowErrors.length) {
      errors.push(...rowErrors);
      return;
    }
    if (barcode) seenBarcodes.add(barcode);
    if (largerBarcode) seenBarcodes.add(largerBarcode);
    if (sku) seenSkus.add(sku);
    valid.push({
      rowNumber,
      name: name!,
      barcode,
      sku,
      category: text(get('category')),
      unit: text(get('unit')),
      costMinor,
      retailMinor,
      wholesaleMinor,
      qtyMilli,
      lowStockMilli,
      largerUnit,
      largerFactorMilli,
      largerPriceMinor,
      largerBarcode,
    });
  });
  return { valid, errors, skippedEmpty };
}

/** Header row + one example row for the downloadable template (Arabic headers). */
export const IMPORT_TEMPLATE_AR: { headers: string[]; example: (string | number)[] } = {
  headers: ['الاسم', 'الباركود', 'كود الصنف', 'القسم', 'الوحدة', 'سعر الشراء', 'سعر البيع', 'سعر الجملة', 'الكمية', 'حد الطلب', 'الوحدة الكبيرة', 'عدد في العبوة', 'سعر العبوة', 'باركود العبوة'],
  example: ['شاي العروسة 250 جم', '6221234567890', 'T-250', 'مشروبات', 'قطعة', 18.5, 22, 20, 48, 12, 'كرتونة', 24, 500, '16221234567897'],
};
