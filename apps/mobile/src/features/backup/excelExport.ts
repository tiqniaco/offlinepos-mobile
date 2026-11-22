/** Excel of the main data (PLAN.md §9.5) — always allowed, even read-only: one workbook, one sheet per area. */
import * as XLSX from 'xlsx';
import { File, Paths } from 'expo-file-system';
import { sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { shareFile } from '../export/whatsapp';

const rows = async (q: ReturnType<typeof sql>) => (await getDb().all(q)) as Record<string, unknown>[];
const money = (v: unknown) => Number(v ?? 0) / 100;

export async function exportAllToExcel() {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const add = (name: string, data: Record<string, unknown>[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.length ? data : [{}]), name);
  add('المنتجات', (await rows(sql`SELECT p.name AS "المنتج", p.sku AS "الكود", c.name AS "القسم", p.retail_price_minor AS price, p.cost_minor AS cost, coalesce(s.qty_milli, 0) AS qty FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN stock_levels s ON s.product_id = p.id WHERE p.deleted_at IS NULL ORDER BY p.name`)).map((r) => ({ ...r, price: money(r.price), cost: money(r.cost), qty: Number(r.qty) / 1000 })));
  add('العملاء', (await rows(sql`SELECT c.name AS "الاسم", c.mobile AS "الموبايل", c.address AS "العنوان", coalesce(b.balance_minor, 0) AS balance FROM customers c LEFT JOIN party_balances b ON b.party_type = 'C' AND b.party_id = c.id WHERE c.deleted_at IS NULL ORDER BY c.name`)).map((r) => ({ ...r, balance: money(r.balance) })));
  add('الموردين', (await rows(sql`SELECT s.name AS "الاسم", s.mobile AS "الموبايل", -coalesce(b.balance_minor, 0) AS owed FROM suppliers s LEFT JOIN party_balances b ON b.party_type = 'S' AND b.party_id = s.id WHERE s.deleted_at IS NULL ORDER BY s.name`)).map((r) => ({ ...r, owed: money(r.owed) })));
  add('الفواتير', (await rows(sql`SELECT number AS "الرقم", type AS "النوع", status AS "الحالة", business_day AS "اليوم", customer_name AS "العميل", total_minor AS total, paid_minor AS paid, credit_minor AS credit FROM sales_docs WHERE status IN ('POSTED','VOIDED') ORDER BY posted_at`)).map((r) => ({ ...r, total: money(r.total), paid: money(r.paid), credit: money(r.credit) })));
  add('المدفوعات', (await rows(sql`SELECT business_day AS "اليوم", kind AS "النوع", direction AS "الاتجاه", method AS "الطريقة", amount_minor AS amount, voided AS "ملغي" FROM payments ORDER BY posted_at`)).map((r) => ({ ...r, amount: money(r.amount) })));
  add('المشتريات', (await rows(sql`SELECT number AS "الرقم", type AS "النوع", status AS "الحالة", business_day AS "اليوم", supplier_name AS "المورد", total_minor AS total, credit_minor AS credit FROM purchase_docs WHERE status IN ('POSTED','VOIDED') ORDER BY posted_at`)).map((r) => ({ ...r, total: money(r.total), credit: money(r.credit) })));
  add('المصروفات والسندات', (await rows(sql`SELECT number AS "الرقم", type AS "النوع", status AS "الحالة", business_day AS "اليوم", coalesce(party_name, category_name) AS "البيان", method AS "الطريقة", amount_minor AS amount, note AS "ملاحظة" FROM vouchers ORDER BY posted_at`)).map((r) => ({ ...r, amount: money(r.amount) })));
  const f = new File(Paths.cache, `daftarak-data-${new Date().toISOString().slice(0, 10)}.xlsx`);
  if (f.exists) f.delete();
  f.create();
  f.write(XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string, { encoding: 'base64' });
  await shareFile(f.uri, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel', 'org.openxmlformats.spreadsheetml.sheet');
}
