/**
 * Reports (SPEC §5): all on the phone, indexed SQL aggregates only (no row-by-row JS over the whole DB),
 * so they stay fast at 100k invoices. Returns plain data; features/reports turns it into ReportDocs.
 * Sales figures count POSTED invoices minus POSTED returns (voided invoices are excluded entirely).
 * Profit = net (excl. VAT) − cost snapshot taken at posting (moving average).
 */
import { sql } from 'drizzle-orm';
import { addDays, agingBuckets } from '@daftarak/shared';
import type { Db } from '../../db/types';

export interface Range {
  from: number;
  to: number;
}

type Num = number | null;
const n = (v: Num | string | undefined) => Number(v ?? 0);
const all = <T>(db: Db, q: ReturnType<typeof sql>) => db.all(q) as unknown as Promise<T[]>;

/** sign: +1 invoice, −1 return */
const SIGN = sql`CASE d.type WHEN 'RETURN' THEN -1 ELSE 1 END`;
const LINE_COST = sql`coalesce(l.unit_cost_minor, 0) * l.base_qty_milli / 1000.0`;
const POSTED_SALES = sql`d.status = 'POSTED' AND d.type IN ('INVOICE', 'RETURN')`;
/** Line-only versions (no join to the documents): return lines always carry original_line_id; drafts, parked carts,
 *  quotations and voided invoices are a small set excluded by id (index sales_docs_status). */
const LSIGN = sql`CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END`;
const LIVE_LINES = sql`l.doc_id NOT IN (SELECT id FROM sales_docs WHERE status <> 'POSTED' OR type = 'QUOTATION')`;

// ─────────────────────────── dashboard ───────────────────────────

export interface Dashboard {
  todaySalesMinor: number;
  todayInvoices: number;
  todayProfitMinor: number;
  monthSalesMinor: number;
  monthProfitMinor: number;
  receivablesMinor: number;
  payablesMinor: number;
  lowStock: number;
  stockValueMinor: number;
  last30: { day: number; salesMinor: number }[];
  topItems: { name: string; qtyMilli: number; salesMinor: number }[];
}

export async function dashboard(db: Db, today: number): Promise<Dashboard> {
  const month = Math.floor(today / 100) * 100 + 1;
  const from30 = addDays(today, -29);
  const sumRange = async (from: number, to: number) => {
    const r = (await all<{ sales: Num; profit: Num; inv: Num }>(db, sql`
      SELECT sum(${SIGN} * l.total_minor) AS sales, sum(${SIGN} * (l.net_minor - ${LINE_COST})) AS profit,
             count(DISTINCT CASE WHEN d.type = 'INVOICE' THEN d.id END) AS inv
      FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id
      WHERE l.business_day BETWEEN ${from} AND ${to} AND ${POSTED_SALES}`))[0];
    return { sales: n(r?.sales), profit: Math.round(n(r?.profit)), inv: n(r?.inv) };
  };
  const t = await sumRange(today, today);
  const m = await sumRange(month, today);
  const days = await all<{ day: number; sales: Num }>(db, sql`
    SELECT d.business_day AS day, sum(${SIGN} * d.total_minor) AS sales
    FROM sales_docs d WHERE d.business_day BETWEEN ${from30} AND ${today} AND ${POSTED_SALES}
    GROUP BY d.business_day`);
  const byDay = new Map(days.map((x) => [x.day, n(x.sales)]));
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(from30, i)).map((day) => ({ day, salesMinor: byDay.get(day) ?? 0 }));
  const top = await all<{ name: string; qty: Num; sales: Num }>(db, sql`
    SELECT p.name AS name, sum(${SIGN} * l.base_qty_milli) AS qty, sum(${SIGN} * l.total_minor) AS sales
    FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id JOIN products p ON p.id = l.product_id
    WHERE l.business_day BETWEEN ${addDays(today, -6)} AND ${today} AND ${POSTED_SALES}
    GROUP BY l.product_id ORDER BY sales DESC LIMIT 5`);
  const bal = (await all<{ ar: Num; ap: Num }>(db, sql`
    SELECT sum(CASE WHEN party_type = 'C' AND balance_minor > 0 THEN balance_minor ELSE 0 END) AS ar,
           sum(CASE WHEN party_type = 'S' AND balance_minor < 0 THEN -balance_minor ELSE 0 END) AS ap
    FROM party_balances`))[0];
  const stock = (await all<{ low: Num; value: Num }>(db, sql`
    SELECT sum(CASE WHEN p.track_stock = 1 AND p.low_stock_milli IS NOT NULL AND coalesce(s.qty_milli, 0) <= p.low_stock_milli THEN 1 ELSE 0 END) AS low,
           sum(CASE WHEN s.value_minor > 0 THEN s.value_minor ELSE 0 END) AS value
    FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id WHERE p.deleted_at IS NULL`))[0];
  return {
    todaySalesMinor: t.sales,
    todayInvoices: t.inv,
    todayProfitMinor: t.profit,
    monthSalesMinor: m.sales,
    monthProfitMinor: m.profit,
    receivablesMinor: n(bal?.ar),
    payablesMinor: n(bal?.ap),
    lowStock: n(stock?.low),
    stockValueMinor: n(stock?.value),
    last30,
    topItems: top.map((x) => ({ name: x.name, qtyMilli: n(x.qty), salesMinor: n(x.sales) })),
  };
}

// ─────────────────────────── sales ───────────────────────────

export interface SalesRow {
  key: string;
  label: string;
  invoices: number;
  qtyMilli: number;
  salesMinor: number;
  netMinor: number;
  taxMinor: number;
  discountMinor: number;
  returnsMinor: number;
  profitMinor: number;
}

export type SalesGroup = 'day' | 'product' | 'category' | 'customer' | 'user';

type Agg = { k: string; invoices: Num; qty: Num; sales: Num; net: Num; tax: Num; disc: Num; rets: Num; costm: Num };

const LCOLS = sql`
  count(DISTINCT CASE WHEN l.original_line_id IS NULL THEN l.doc_id END) AS invoices,
  sum(${LSIGN} * l.base_qty_milli) AS qty, sum(${LSIGN} * l.total_minor) AS sales, sum(${LSIGN} * l.net_minor) AS net,
  sum(${LSIGN} * l.tax_minor) AS tax,
  sum(CASE WHEN l.original_line_id IS NULL THEN l.offer_discount_minor + l.line_discount_minor + l.invoice_discount_minor ELSE 0 END) AS disc,
  sum(CASE WHEN l.original_line_id IS NULL THEN 0 ELSE l.total_minor END) AS rets,
  sum(${LSIGN} * coalesce(l.unit_cost_minor, 0) * l.base_qty_milli) AS costm`;
const RCOLS = sql`sum(invoices) AS invoices, sum(qty_milli) AS qty, sum(sales_minor) AS sales, sum(net_minor) AS net, sum(tax_minor) AS tax, sum(disc_minor) AS disc, sum(rets_minor) AS rets, sum(cost_milli) AS costm`;

const lastDay = (d: number) => addDays(d, 1) % 100 === 1;
/** Split a range into partial edge ranges (scanned from lines) and whole months (read from the roll-up). */
export function splitRange(r: Range): { edges: Range[]; months: [number, number] | null } {
  const fm = Math.floor(r.from / 100);
  const tm = Math.floor(r.to / 100);
  const firstFull = r.from % 100 === 1 ? fm : fm + (fm % 100 === 12 ? 89 : 1);
  const lastFull = lastDay(r.to) ? tm : tm % 100 === 1 ? tm - 89 : tm - 1;
  if (firstFull > lastFull) return { edges: [r], months: null };
  const edges: Range[] = [];
  if (r.from % 100 !== 1) edges.push({ from: r.from, to: addDays(firstFull * 100 + 1, -1) });
  if (!lastDay(r.to)) edges.push({ from: Math.floor(r.to / 100) * 100 + 1, to: r.to });
  return { edges, months: [firstFull, lastFull] };
}

/** Aggregate by product / customer / cashier: whole months from the roll-up + edge days from the lines. */
async function aggregate(db: Db, dim: 'P' | 'C' | 'U', r: Range): Promise<Map<string, Agg>> {
  const { edges, months } = splitRange(r);
  const parts: Agg[] = [];
  if (months) parts.push(...(await all<Agg>(db, sql`SELECT key AS k, ${RCOLS} FROM sales_rollup WHERE dim = ${dim} AND month BETWEEN ${months[0]} AND ${months[1]} GROUP BY key`)));
  for (const e of edges) {
    const where = sql`l.business_day BETWEEN ${e.from} AND ${e.to} AND ${LIVE_LINES}`;
    if (dim === 'P') parts.push(...(await all<Agg>(db, sql`SELECT l.product_id AS k, ${LCOLS} FROM sales_lines l WHERE ${where} GROUP BY l.product_id`)));
    else {
      const col = dim === 'C' ? sql`d.customer_id` : sql`d.cashier_id`;
      parts.push(...(await all<Agg>(db, sql`SELECT coalesce(${col}, '') AS k, ${LCOLS} FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE ${where} GROUP BY 1`)));
    }
  }
  const out = new Map<string, Agg>();
  for (const p of parts) {
    const a = out.get(p.k);
    if (!a) out.set(p.k, { ...p });
    else for (const f of ['invoices', 'qty', 'sales', 'net', 'tax', 'disc', 'rets', 'costm'] as const) a[f] = n(a[f]) + n(p[f]);
  }
  return out;
}

const fromAgg = (k: string, label: string, a: Agg): SalesRow => ({
  key: k,
  label,
  invoices: n(a.invoices),
  qtyMilli: n(a.qty),
  salesMinor: n(a.sales),
  netMinor: n(a.net),
  taxMinor: n(a.tax),
  discountMinor: n(a.disc),
  returnsMinor: n(a.rets),
  profitMinor: n(a.net) - Math.round(n(a.costm) / 1000),
});

export async function salesBy(db: Db, group: SalesGroup, r: Range): Promise<SalesRow[]> {
  if (group === 'day') {
    const { edges, months } = splitRange(r);
    const rows: Agg[] = [];
    if (months) rows.push(...(await all<Agg>(db, sql`SELECT key AS k, ${RCOLS} FROM sales_rollup WHERE dim = 'D' AND month BETWEEN ${months[0]} AND ${months[1]} GROUP BY key`)));
    for (const e of edges) rows.push(...(await all<Agg>(db, sql`SELECT CAST(l.business_day AS TEXT) AS k, ${LCOLS} FROM sales_lines l WHERE l.business_day BETWEEN ${e.from} AND ${e.to} AND ${LIVE_LINES} GROUP BY l.business_day`)));
    return rows
      .map((x) => fromAgg(String(x.k), String(x.k), x))
      .filter((x) => x.salesMinor || x.invoices)
      .sort((a, b) => Number(a.key) - Number(b.key));
  }
  const byKey = await aggregate(db, group === 'customer' ? 'C' : group === 'user' ? 'U' : 'P', r);
  const keys = [...byKey.keys()].filter(Boolean);
  let rows: SalesRow[];
  if (group === 'product' || group === 'category') {
    const meta = keys.length ? await all<{ id: string; name: string; cat: string | null; catName: string | null }>(db, sql`SELECT p.id, p.name, p.category_id AS cat, c.name AS catName FROM products p LEFT JOIN categories c ON c.id = p.category_id`) : [];
    const m = new Map(meta.map((x) => [x.id, x]));
    if (group === 'product') rows = [...byKey].map(([k, a]) => fromAgg(k, m.get(k)?.name ?? '—', a));
    else {
      const cats = new Map<string, { label: string; a: Agg }>();
      for (const [k, a] of byKey) {
        const c = m.get(k);
        const ck = c?.cat ?? '';
        const cur = cats.get(ck);
        if (!cur) cats.set(ck, { label: c?.catName ?? '—', a: { ...a } });
        else for (const f of ['invoices', 'qty', 'sales', 'net', 'tax', 'disc', 'rets', 'costm'] as const) cur.a[f] = n(cur.a[f]) + n(a[f]);
      }
      rows = [...cats].map(([k, v]) => fromAgg(k, v.label, v.a));
    }
  } else {
    const names = group === 'customer'
      ? await all<{ id: string; name: string }>(db, sql`SELECT id, name FROM customers`)
      : await all<{ id: string; name: string }>(db, sql`SELECT id, name FROM users`);
    const nm = new Map(names.map((x) => [x.id, x.name]));
    rows = [...byKey].map(([k, a]) => fromAgg(k, nm.get(k) ?? (k ? '—' : ''), a));
  }
  return rows.filter((x) => x.salesMinor || x.qtyMilli || x.invoices).sort((a, b) => b.salesMinor - a.salesMinor);
}

/** Discounts per user: manual line, manual invoice, offers, coupons (invoices only). */
export async function discountsByUser(db: Db, r: Range) {
  const rows = await all<{ k: string; label: string; inv: Num; line: Num; invd: Num; offers: Num; coupons: Num; gross: Num }>(db, sql`
    SELECT d.cashier_id AS k, coalesce(u.name, '—') AS label, count(*) AS inv, sum(d.line_discount_minor) AS line, sum(d.invoice_discount_minor) AS invd,
           sum(d.offer_discount_minor) AS offers, sum(d.coupon_discount_minor) AS coupons, sum(d.gross_minor) AS gross
    FROM sales_docs d LEFT JOIN users u ON u.id = d.cashier_id
    WHERE d.business_day BETWEEN ${r.from} AND ${r.to} AND d.status = 'POSTED' AND d.type = 'INVOICE'
    GROUP BY d.cashier_id ORDER BY (sum(d.line_discount_minor) + sum(d.invoice_discount_minor)) DESC`);
  return rows.map((x) => ({ key: x.k, label: x.label, invoices: n(x.inv), lineMinor: n(x.line), invoiceMinor: n(x.invd), offersMinor: n(x.offers), couponsMinor: n(x.coupons), grossMinor: n(x.gross) }));
}

// ─────────────────────────── purchases ───────────────────────────

export async function purchasesBySupplier(db: Db, r: Range) {
  const rows = await all<{ k: string; label: string; n: Num; total: Num; paid: Num; credit: Num; rets: Num }>(db, sql`
    SELECT coalesce(supplier_id, '') AS k, coalesce(max(supplier_name), '—') AS label,
           sum(CASE WHEN type = 'PURCHASE' THEN 1 ELSE 0 END) AS n,
           sum(CASE WHEN type = 'PURCHASE' THEN total_minor ELSE -total_minor END) AS total,
           sum(CASE WHEN type = 'PURCHASE' THEN paid_minor ELSE 0 END) AS paid,
           sum(CASE WHEN type = 'PURCHASE' THEN credit_minor ELSE 0 END) AS credit,
           sum(CASE WHEN type = 'PURCHASE_RETURN' THEN total_minor ELSE 0 END) AS rets
    FROM purchase_docs WHERE status = 'POSTED' AND business_day BETWEEN ${r.from} AND ${r.to}
    GROUP BY supplier_id ORDER BY total DESC`);
  return rows.map((x) => ({ key: x.k, label: x.label, invoices: n(x.n), totalMinor: n(x.total), paidMinor: n(x.paid), creditMinor: n(x.credit), returnsMinor: n(x.rets) }));
}

// ─────────────────────────── profit & loss (from the journal) ───────────────────────────

export interface PnL {
  salesMinor: number;
  returnsMinor: number;
  netSalesMinor: number;
  cogsMinor: number;
  grossProfitMinor: number;
  expensesMinor: number;
  expensesByCategory: { name: string; amountMinor: number }[];
  stockAdjMinor: number;
  cashOverShortMinor: number;
  roundingMinor: number;
  netProfitMinor: number;
}

export async function profitAndLoss(db: Db, r: Range): Promise<PnL> {
  const rows = await all<{ key: string; d: Num; c: Num }>(db, sql`
    SELECT a.system_key AS key, sum(jl.debit_minor) AS d, sum(jl.credit_minor) AS c
    FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
    WHERE jl.business_day BETWEEN ${r.from} AND ${r.to} AND a.type IN ('INCOME', 'EXPENSE')
    GROUP BY a.system_key`);
  const cr = (k: string) => {
    const x = rows.find((y) => y.key === k);
    return n(x?.c) - n(x?.d);
  };
  const sales = cr('SALES');
  const returns = -cr('SALES_RETURNS');
  const cogs = -cr('COGS');
  const expenses = -cr('EXPENSES');
  const stockAdj = -cr('STOCK_ADJ');
  const overShort = -cr('CASH_OVER_SHORT');
  const rounding = cr('ROUNDING');
  const cats = await all<{ name: string; amt: Num }>(db, sql`
    SELECT coalesce(category_name, '—') AS name, sum(amount_minor) AS amt FROM vouchers
    WHERE type = 'EXPENSE' AND status = 'POSTED' AND business_day BETWEEN ${r.from} AND ${r.to}
    GROUP BY category_name ORDER BY amt DESC`);
  const netSales = sales - returns;
  const gross = netSales - cogs;
  return {
    salesMinor: sales,
    returnsMinor: returns,
    netSalesMinor: netSales,
    cogsMinor: cogs,
    grossProfitMinor: gross,
    expensesMinor: expenses,
    expensesByCategory: cats.map((c) => ({ name: c.name, amountMinor: n(c.amt) })),
    stockAdjMinor: stockAdj,
    cashOverShortMinor: overShort,
    roundingMinor: rounding,
    netProfitMinor: gross - expenses - stockAdj - overShort + rounding,
  };
}

// ─────────────────────────── stock ───────────────────────────

/**
 * Stock value per product. valueMinor is signed (it reconciles with the INVENTORY account); a negative value comes from
 * selling below zero and is NOT stock you own: stockValuationTotals keeps it out of the value and shows it apart.
 */
export async function stockValuation(db: Db) {
  const rows = await all<{ id: string; name: string; cat: string | null; unit: string; qty: Num; avg: Num; value: Num; retail: Num }>(db, sql`
    SELECT p.id, p.name, c.name AS cat, coalesce(u.name_ar, '') AS unit, coalesce(s.qty_milli, 0) AS qty, coalesce(s.avg_cost_minor, p.cost_minor) AS avg,
           coalesce(s.value_minor, 0) AS value, p.retail_price_minor * coalesce(s.qty_milli, 0) / 1000.0 AS retail
    FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN units u ON u.id = p.base_unit_id
    WHERE p.deleted_at IS NULL AND p.track_stock = 1 ORDER BY value DESC`);
  return rows.map((x) => ({ id: x.id, name: x.name, category: x.cat, unit: x.unit, qtyMilli: n(x.qty), avgCostMinor: n(x.avg), valueMinor: n(x.value), retailValueMinor: Math.round(n(x.retail)) }));
}

/** Totals for the valuation report: owned stock only (positive), and the negative (oversold) value separately. */
export function stockValuationTotals(rows: { qtyMilli: number; valueMinor: number; retailValueMinor: number }[]) {
  let valueMinor = 0;
  let negativeMinor = 0;
  let retailMinor = 0;
  for (const r of rows) {
    if (r.valueMinor > 0) valueMinor += r.valueMinor;
    else negativeMinor += r.valueMinor;
    if (r.qtyMilli > 0) retailMinor += r.retailValueMinor;
  }
  return { valueMinor, negativeMinor, retailMinor };
}

/** Cash rounding of posted invoices minus returns in the range: line-based reports + this = document totals. */
export async function salesRounding(db: Db, r: Range): Promise<number> {
  const x = (await all<{ v: Num }>(db, sql`
    SELECT sum(${SIGN} * d.rounding_minor) AS v FROM sales_docs d
    WHERE d.business_day BETWEEN ${r.from} AND ${r.to} AND ${POSTED_SALES}`))[0];
  return n(x?.v);
}

export async function stockMovementFor(db: Db, productId: string, r: Range) {
  const before = (await all<{ q: Num }>(db, sql`SELECT sum(qty_milli) AS q FROM stock_movements WHERE product_id = ${productId} AND business_day < ${r.from}`))[0];
  const rows = await all<{ id: string; day: number; type: string; qty: number; cost: number; src: string; srcId: string; reason: string | null; num: string | null }>(db, sql`
    SELECT m.id, m.business_day AS day, m.type, m.qty_milli AS qty, m.unit_cost_minor AS cost, m.source_type AS src, m.source_id AS srcId, m.reason,
           coalesce(sd.number, pd.number, idoc.number) AS num
    FROM stock_movements m
    LEFT JOIN sales_docs sd ON sd.id = m.source_id
    LEFT JOIN purchase_docs pd ON pd.id = m.source_id
    LEFT JOIN inventory_docs idoc ON idoc.id = m.source_id
    WHERE m.product_id = ${productId} AND m.business_day BETWEEN ${r.from} AND ${r.to}
    ORDER BY m.rowid`);
  let bal = n(before?.q);
  const opening = bal;
  return { openingMilli: opening, rows: rows.map((x) => ({ ...x, balanceMilli: (bal += x.qty) })), closingMilli: bal };
}

/** In stock but not sold for `days` (dead = never sold). */
export async function slowStock(db: Db, today: number, days: number) {
  const since = addDays(today, -days);
  const rows = await all<{ id: string; name: string; qty: Num; value: Num; last: number | null }>(db, sql`
    SELECT p.id, p.name, s.qty_milli AS qty, s.value_minor AS value,
           (SELECT max(l.business_day) FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id WHERE l.product_id = p.id AND d.type = 'INVOICE' AND d.status = 'POSTED') AS last
    FROM products p JOIN stock_levels s ON s.product_id = p.id
    WHERE p.deleted_at IS NULL AND p.track_stock = 1 AND s.qty_milli > 0`);
  return rows
    .filter((x) => x.last == null || x.last < since)
    .map((x) => ({ id: x.id, name: x.name, qtyMilli: n(x.qty), valueMinor: n(x.value), lastSaleDay: x.last }))
    .sort((a, b) => (a.lastSaleDay ?? 0) - (b.lastSaleDay ?? 0) || b.valueMinor - a.valueMinor);
}

export async function expiringItems(db: Db, today: number, withinDays: number) {
  const until = addDays(today, withinDays);
  const rows = await all<{ name: string; batch: string | null; expiry: number; qty: Num }>(db, sql`
    SELECT p.name, b.batch_no AS batch, b.expiry_day AS expiry, sum(bl.qty_milli) AS qty
    FROM batches b JOIN products p ON p.id = b.product_id JOIN batch_levels bl ON bl.batch_id = b.id
    WHERE b.expiry_day IS NOT NULL AND b.expiry_day <= ${until} AND p.deleted_at IS NULL
    GROUP BY b.id HAVING sum(bl.qty_milli) > 0 ORDER BY b.expiry_day`);
  return rows.map((x) => ({ name: x.name, batchNo: x.batch, expiryDay: x.expiry, qtyMilli: n(x.qty), expired: x.expiry < today }));
}

// ─────────────────────────── aging ───────────────────────────

export async function aging(db: Db, type: 'C' | 'S', today: number) {
  const sign = type === 'C' ? 1 : -1;
  const parties = await all<{ id: string; name: string; bal: number }>(db, sql`
    SELECT b.party_id AS id, coalesce(c.name, s.name, '—') AS name, b.balance_minor AS bal
    FROM party_balances b LEFT JOIN customers c ON c.id = b.party_id LEFT JOIN suppliers s ON s.id = b.party_id
    WHERE b.party_type = ${type} AND b.balance_minor * ${sign} > 0`);
  const out = [];
  for (const p of parties) {
    const rows = await all<{ businessDay: number; at: number; d: number; c: number }>(db, sql`
      SELECT business_day AS businessDay, created_at AS at, debit_minor AS d, credit_minor AS c FROM party_ledger WHERE party_type = ${type} AND party_id = ${p.id}`);
    // Suppliers: flip sides so "what we owe" ages like a receivable.
    const led = rows.map((x) => ({ businessDay: x.businessDay, at: x.at, debitMinor: type === 'C' ? x.d : x.c, creditMinor: type === 'C' ? x.c : x.d }));
    const b = agingBuckets(led, today);
    out.push({ id: p.id, name: p.name, totalMinor: p.bal * sign, buckets: b });
  }
  return out.sort((a, b) => b.totalMinor - a.totalMinor);
}

export async function shiftsReport(db: Db, r: Range) {
  return all<{ number: string; user: string; opened: number; closed: number | null; expected: Num; counted: Num; diff: Num }>(db, sql`
    SELECT number, user_name AS user, opened_at AS opened, closed_at AS closed, expected_cash_minor AS expected, counted_cash_minor AS counted, difference_minor AS diff
    FROM shifts WHERE business_day BETWEEN ${r.from} AND ${r.to} ORDER BY opened_at DESC`);
}
