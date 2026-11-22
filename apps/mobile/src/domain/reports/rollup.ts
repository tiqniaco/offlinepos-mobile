/**
 * Monthly sales roll-up (sales_rollup) — kept in the posting transaction so long-range reports stay fast at
 * 100k+ invoices. Same formulas as the backfill in migration 0011. sign = +1 when a document is posted,
 * −1 when an invoice is voided (exactly undoes what it added).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/types';

const S = sql`CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END`;
const cols = (sign: number) => sql`
  ${sign} * count(DISTINCT CASE WHEN l.original_line_id IS NULL THEN l.doc_id END),
  ${sign} * sum(${S} * l.base_qty_milli),
  ${sign} * sum(${S} * l.total_minor),
  ${sign} * sum(${S} * l.net_minor),
  ${sign} * sum(${S} * l.tax_minor),
  ${sign} * sum(CASE WHEN l.original_line_id IS NULL THEN l.offer_discount_minor + l.line_discount_minor + l.invoice_discount_minor ELSE 0 END),
  ${sign} * sum(CASE WHEN l.original_line_id IS NULL THEN 0 ELSE l.total_minor END),
  ${sign} * sum(${S} * coalesce(l.unit_cost_minor, 0) * l.base_qty_milli)`;
const UPSERT = sql`ON CONFLICT (dim, key, month) DO UPDATE SET
  invoices = invoices + excluded.invoices, qty_milli = qty_milli + excluded.qty_milli, sales_minor = sales_minor + excluded.sales_minor,
  net_minor = net_minor + excluded.net_minor, tax_minor = tax_minor + excluded.tax_minor, disc_minor = disc_minor + excluded.disc_minor,
  rets_minor = rets_minor + excluded.rets_minor, cost_milli = cost_milli + excluded.cost_milli`;
const INTO = sql`INSERT INTO sales_rollup (month, dim, key, invoices, qty_milli, sales_minor, net_minor, tax_minor, disc_minor, rets_minor, cost_milli)`;

/** Add (sign +1) or remove (−1) one posted sales document's figures. Call inside the posting transaction. */
export async function rollupDoc(tx: Db, docId: string, sign: 1 | -1) {
  await tx.run(sql`${INTO} SELECT l.business_day / 100, 'P', l.product_id, ${cols(sign)} FROM sales_lines l WHERE l.doc_id = ${docId} AND l.business_day IS NOT NULL GROUP BY l.business_day / 100, l.product_id ${UPSERT}`);
  await tx.run(sql`${INTO} SELECT l.business_day / 100, 'C', coalesce(d.customer_id, ''), ${cols(sign)} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE l.doc_id = ${docId} AND l.business_day IS NOT NULL GROUP BY 1 ${UPSERT}`);
  await tx.run(sql`${INTO} SELECT l.business_day / 100, 'U', coalesce(d.cashier_id, ''), ${cols(sign)} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE l.doc_id = ${docId} AND l.business_day IS NOT NULL GROUP BY 1 ${UPSERT}`);
  await tx.run(sql`${INTO} SELECT l.business_day / 100, 'D', CAST(l.business_day AS TEXT), ${cols(sign)} FROM sales_lines l WHERE l.doc_id = ${docId} AND l.business_day IS NOT NULL GROUP BY l.business_day ${UPSERT}`);
}

/** Recompute the whole roll-up from posted documents (repair tool, bench, tests). */
export async function rebuildRollup(db: Db) {
  await db.run(sql`DELETE FROM sales_rollup`);
  const posted = sql`d.status = 'POSTED' AND d.type IN ('INVOICE', 'RETURN') AND l.business_day IS NOT NULL`;
  await db.run(sql`${INTO} SELECT l.business_day / 100, 'P', l.product_id, ${cols(1)} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE ${posted} GROUP BY l.business_day / 100, l.product_id`);
  await db.run(sql`${INTO} SELECT l.business_day / 100, 'C', coalesce(d.customer_id, ''), ${cols(1)} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE ${posted} GROUP BY l.business_day / 100, coalesce(d.customer_id, '')`);
  await db.run(sql`${INTO} SELECT l.business_day / 100, 'U', coalesce(d.cashier_id, ''), ${cols(1)} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE ${posted} GROUP BY l.business_day / 100, coalesce(d.cashier_id, '')`);
  await db.run(sql`${INTO} SELECT l.business_day / 100, 'D', CAST(l.business_day AS TEXT), ${cols(1)} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE ${posted} GROUP BY l.business_day`);
}
