/**
 * «موبايل متابعة»: the small summary the main phone sends for the owner's follower phone (read-only).
 * Only aggregates + short lists (≤ 48 KB): never the whole database.
 */
import { sql } from 'drizzle-orm';
import { addDays, SNAPSHOT_MAX_BYTES, type ShopSnapshot } from '@daftarak/shared';
import type { Db } from '../../db/types';
import { dashboard } from '../reports/reports';
import { shiftSummary } from '../shifts/shifts';

type Num = number | string | null | undefined;
const n = (v: Num) => Number(v ?? 0);
const all = <T>(db: Db, q: ReturnType<typeof sql>) => db.all(q) as unknown as Promise<T[]>;
const cut = (s: string | null | undefined, max: number) => (s == null ? null : s.length > max ? s.slice(0, max) : s);

export async function buildSnapshot(db: Db, day: number, currency: string, now = Date.now()): Promise<ShopSnapshot> {
  const d = await dashboard(db, day);
  const month = Math.floor(day / 100) * 100 + 1;
  const yesterday = addDays(day, -1);

  const [todayDocs] = await all<{ rets: Num }>(db, sql`
    SELECT coalesce(sum(total_minor), 0) AS rets FROM sales_docs WHERE business_day = ${day} AND type = 'RETURN' AND status = 'POSTED'`);
  const [exp] = await all<{ today: Num; month: Num }>(db, sql`
    SELECT coalesce(sum(CASE WHEN business_day = ${day} THEN amount_minor ELSE 0 END), 0) AS today, coalesce(sum(amount_minor), 0) AS month
    FROM vouchers WHERE type = 'EXPENSE' AND status = 'POSTED' AND business_day BETWEEN ${month} AND ${day}`);
  const [pur] = await all<{ total: Num }>(db, sql`
    SELECT coalesce(sum(CASE type WHEN 'PURCHASE_RETURN' THEN -total_minor ELSE total_minor END), 0) AS total
    FROM purchase_docs WHERE status = 'POSTED' AND business_day BETWEEN ${month} AND ${day}`);
  const methods = await all<{ method: string; amt: Num }>(db, sql`
    SELECT method, sum(CASE direction WHEN 'IN' THEN amount_minor ELSE -amount_minor END) AS amt FROM payments
    WHERE business_day = ${day} AND voided = 0 AND kind IN ('SALE', 'REFUND', 'RECEIPT') AND method <> 'credit'
    GROUP BY method ORDER BY amt DESC`);
  const [stockOut] = await all<{ out: Num }>(db, sql`
    SELECT count(*) AS out FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id
    WHERE p.deleted_at IS NULL AND p.track_stock = 1 AND coalesce(s.qty_milli, 0) <= 0`);
  const low = await all<{ name: string; qty: Num }>(db, sql`
    SELECT p.name AS name, coalesce(s.qty_milli, 0) AS qty FROM products p LEFT JOIN stock_levels s ON s.product_id = p.id
    WHERE p.deleted_at IS NULL AND p.track_stock = 1 AND p.low_stock_milli IS NOT NULL AND coalesce(s.qty_milli, 0) <= p.low_stock_milli
    ORDER BY coalesce(s.qty_milli, 0) ASC LIMIT 15`);
  const recent = await all<{ no: string | null; type: 'INVOICE' | 'RETURN'; status: 'POSTED' | 'VOIDED'; at: Num; total: Num; party: string | null; cashier: string | null }>(db, sql`
    SELECT d.number AS no, d.type AS type, d.status AS status, coalesce(d.posted_at, d.issued_at, 0) AS at, d.total_minor AS total,
           d.customer_name AS party, u.name AS cashier
    FROM sales_docs d LEFT JOIN users u ON u.id = d.cashier_id
    WHERE d.type IN ('INVOICE', 'RETURN') AND d.status IN ('POSTED', 'VOIDED')
    ORDER BY coalesce(d.posted_at, d.issued_at, 0) DESC LIMIT 20`);
  const open = await all<{ id: string; user: string; openedAt: Num }>(db, sql`
    SELECT id, user_name AS user, opened_at AS openedAt FROM shifts WHERE status = 'OPEN' ORDER BY opened_at LIMIT 5`);
  const shifts = [];
  for (const s of open) {
    const sum = await shiftSummary(db, s.id).catch(() => null);
    shifts.push({ user: cut(s.user, 60) ?? '', openedAt: n(s.openedAt), expectedCashMinor: sum?.expectedCashMinor ?? 0 });
  }

  const snap: ShopSnapshot = {
    v: 1,
    at: now,
    day,
    currency: currency.slice(0, 3),
    today: {
      salesMinor: d.todaySalesMinor,
      invoices: d.todayInvoices,
      returnsMinor: n(todayDocs?.rets),
      profitMinor: d.todayProfitMinor,
      expensesMinor: n(exp?.today),
      byMethod: methods.filter((m) => n(m.amt) !== 0).slice(0, 6).map((m) => ({ method: m.method.slice(0, 10), amountMinor: n(m.amt) })),
    },
    yesterdaySalesMinor: d.last30.find((x) => x.day === yesterday)?.salesMinor ?? 0,
    month: { salesMinor: d.monthSalesMinor, profitMinor: d.monthProfitMinor, expensesMinor: n(exp?.month), purchasesMinor: n(pur?.total) },
    receivablesMinor: d.receivablesMinor,
    payablesMinor: d.payablesMinor,
    stock: { valueMinor: d.stockValueMinor, low: d.lowStock, out: n(stockOut?.out) },
    shifts,
    last14: d.last30.slice(-14),
    top: d.topItems.slice(0, 8).map((x) => ({ name: cut(x.name, 80) ?? '', qtyMilli: Math.round(x.qtyMilli), salesMinor: x.salesMinor })),
    lowItems: low.map((x) => ({ name: cut(x.name, 80) ?? '', qtyMilli: Math.round(n(x.qty)) })),
    recent: recent.map((r) => ({ no: cut(r.no, 30), type: r.type, status: r.status, at: n(r.at), totalMinor: n(r.total), party: cut(r.party, 80), cashier: cut(r.cashier, 60) })),
  };
  // Never over the server cap: drop the longest lists first (names can be long).
  while (JSON.stringify(snap).length > SNAPSHOT_MAX_BYTES - 1024 && (snap.recent.length || snap.lowItems.length)) {
    if (snap.recent.length > 5) snap.recent = snap.recent.slice(0, snap.recent.length - 5);
    else if (snap.lowItems.length) snap.lowItems = snap.lowItems.slice(0, -5);
    else snap.recent = [];
  }
  return snap;
}

/** Stable fingerprint of the figures (ignores the build time): unchanged → nothing to send. */
export function snapshotKey(s: ShopSnapshot): string {
  const { at: _at, ...rest } = s;
  return JSON.stringify(rest);
}
