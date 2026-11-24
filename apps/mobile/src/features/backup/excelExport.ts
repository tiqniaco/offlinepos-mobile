/** Excel of the main data (PLAN.md §9.5) — always allowed, even read-only: one workbook, one sheet per area. */
import { File, Paths } from 'expo-file-system';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { shareFile } from '../export/whatsapp';
import { approveDataExport } from '../approval/exportGate';
import type { Approval } from '../../domain/auth/approval';

/** SheetJS is ~1 MB: required on first use only, so it never slows the app start. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const xlsx = (): typeof import('xlsx') => require('xlsx');

const money = (v: unknown) => Number(v ?? 0) / 100;
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));
/** Rows read and appended per step; the UI gets a turn between steps (no long freeze on big shops). */
const CHUNK = 1000;

export interface ExcelRange {
  /** Business days YYYYMMDD, inclusive. Applies to documents, payments and vouchers (lists are always complete). */
  from: number;
  to: number;
}

type Row = Record<string, unknown>;

/** Builds the workbook one sheet at a time, in chunks of rows, yielding between them. */
export async function exportAllToExcel(opts: { range?: ExcelRange | null; onProgress?: (p: number) => void; approvedBy?: Approval | null } = {}) {
  await approveDataExport('export', 'excel', opts.approvedBy);
  const X = xlsx();
  const db = getDb();
  const wb = X.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const r = opts.range;
  const inRange = (col: string) => (r ? sql` AND ${sql.raw(col)} BETWEEN ${r.from} AND ${r.to}` : sql``);

  const sheets: { name: string; query: (limit: number, offset: number) => ReturnType<typeof sql>; map: (row: Row) => Row }[] = [
    {
      name: 'المنتجات',
      query: (l, o) => sql`SELECT p.name AS "المنتج", p.sku AS "الكود", c.name AS "القسم", p.retail_price_minor AS price, p.cost_minor AS cost, coalesce(s.qty_milli, 0) AS qty FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN stock_levels s ON s.product_id = p.id WHERE p.deleted_at IS NULL ORDER BY p.name LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, price: money(x.price), cost: money(x.cost), qty: Number(x.qty) / 1000 }),
    },
    {
      name: 'العملاء',
      query: (l, o) => sql`SELECT c.name AS "الاسم", c.mobile AS "الموبايل", c.address AS "العنوان", coalesce(b.balance_minor, 0) AS balance FROM customers c LEFT JOIN party_balances b ON b.party_type = 'C' AND b.party_id = c.id WHERE c.deleted_at IS NULL ORDER BY c.name LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, balance: money(x.balance) }),
    },
    {
      name: 'الموردين',
      query: (l, o) => sql`SELECT s.name AS "الاسم", s.mobile AS "الموبايل", -coalesce(b.balance_minor, 0) AS owed FROM suppliers s LEFT JOIN party_balances b ON b.party_type = 'S' AND b.party_id = s.id WHERE s.deleted_at IS NULL ORDER BY s.name LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, owed: money(x.owed) }),
    },
    {
      name: 'الفواتير',
      query: (l, o) => sql`SELECT number AS "الرقم", type AS "النوع", status AS "الحالة", business_day AS "اليوم", customer_name AS "العميل", total_minor AS total, paid_minor AS paid, credit_minor AS credit FROM sales_docs WHERE status IN ('POSTED','VOIDED')${inRange('business_day')} ORDER BY posted_at LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, total: money(x.total), paid: money(x.paid), credit: money(x.credit) }),
    },
    {
      name: 'المدفوعات',
      query: (l, o) => sql`SELECT business_day AS "اليوم", kind AS "النوع", direction AS "الاتجاه", method AS "الطريقة", amount_minor AS amount, voided AS "ملغي" FROM payments WHERE 1 = 1${inRange('business_day')} ORDER BY posted_at LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, amount: money(x.amount) }),
    },
    {
      name: 'المشتريات',
      query: (l, o) => sql`SELECT number AS "الرقم", type AS "النوع", status AS "الحالة", business_day AS "اليوم", supplier_name AS "المورد", total_minor AS total, credit_minor AS credit FROM purchase_docs WHERE status IN ('POSTED','VOIDED')${inRange('business_day')} ORDER BY posted_at LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, total: money(x.total), credit: money(x.credit) }),
    },
    {
      name: 'المصروفات والسندات',
      query: (l, o) => sql`SELECT number AS "الرقم", type AS "النوع", status AS "الحالة", business_day AS "اليوم", coalesce(party_name, category_name) AS "البيان", method AS "الطريقة", amount_minor AS amount, note AS "ملاحظة" FROM vouchers WHERE 1 = 1${inRange('business_day')} ORDER BY posted_at LIMIT ${l} OFFSET ${o}`,
      map: (x) => ({ ...x, amount: money(x.amount) }),
    },
  ];

  for (let i = 0; i < sheets.length; i++) {
    const sh = sheets[i]!;
    let ws: ReturnType<typeof X.utils.json_to_sheet> | null = null;
    for (let offset = 0; ; offset += CHUNK) {
      const chunk = ((await db.all(sh.query(CHUNK, offset))) as Row[]).map(sh.map);
      if (!ws) ws = X.utils.json_to_sheet(chunk.length ? chunk : [{}]);
      else if (chunk.length) X.utils.sheet_add_json(ws, chunk, { origin: -1, skipHeader: true });
      await yieldUi();
      if (chunk.length < CHUNK) break;
    }
    X.utils.book_append_sheet(wb, ws!, sh.name);
    opts.onProgress?.((i + 1) / (sheets.length + 1));
  }
  await yieldUi();
  const suffix = r ? `${r.from}-${r.to}` : new Date().toISOString().slice(0, 10);
  const f = new File(Paths.cache, `daftarak-data-${suffix}.xlsx`);
  if (f.exists) f.delete();
  f.create();
  await f.write(X.write(wb, { type: 'base64', bookType: 'xlsx' }) as string, { encoding: 'base64' });
  opts.onProgress?.(1);
  await shareFile(f.uri, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel', 'org.openxmlformats.spreadsheetml.sheet');
}
