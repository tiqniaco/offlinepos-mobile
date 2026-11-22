/**
 * Report speed bench (Phase 5 acceptance): 100k invoices (~600k lines) + 5k returns, 2k products, 1.5k customers,
 * then time every report. Rows are inserted with raw SQL in the same shape posting produces (much faster than
 * posting 100k sales one by one). Run: npx tsx scripts/bench-reports.ts
 * Node + better-sqlite3 on a CI machine is a proxy; re-run on a mid-range Android before release (PLAN.md R-xx).
 */
import { createTestDb } from '../src/test/testDb';
import { rebuildRollup } from '../src/domain/reports/rollup';
import { aging, dashboard, discountsByUser, profitAndLoss, purchasesBySupplier, salesBy, slowStock, stockMovementFor, stockValuation } from '../src/domain/reports/reports';
import { sql } from 'drizzle-orm';
import { addDays } from '@daftarak/shared';

const INVOICES = Number(process.env.N ?? 100_000);
const db = createTestDb();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (db as any).$client as import('better-sqlite3').Database;
const t0 = Date.now();
const today = 20261122;
const start = addDays(today, -364);

raw.pragma('foreign_keys = OFF');
raw.exec('BEGIN');
const insP = raw.prepare(`INSERT INTO products (id, created_at, updated_at, hlc, name, base_unit_id, cost_minor, retail_price_minor, wholesale_price_minor, track_stock, track_expiry, category_id) VALUES (?, 0, 0, 'h', ?, 'u', ?, ?, 0, 1, 0, ?)`);
const insC = raw.prepare(`INSERT INTO categories (id, created_at, updated_at, hlc, name, sort) VALUES (?, 0, 0, 'h', ?, 0)`);
for (let c = 0; c < 20; c++) insC.run(`cat${c}`, `قسم ${c}`);
const prods: { id: string; price: number; cost: number }[] = [];
for (let i = 0; i < 2000; i++) {
  const price = 500 + ((i * 37) % 20_000);
  prods.push({ id: `p${i}`, price, cost: Math.round(price * 0.7) });
  insP.run(`p${i}`, `منتج رقم ${i}`, Math.round(price * 0.7), price, `cat${i % 20}`);
}
const insSL = raw.prepare(`INSERT INTO stock_levels (product_id, warehouse_id, qty_milli, avg_cost_minor, value_minor, last_movement_at) VALUES (?, 'w', ?, ?, ?, 0)`);
for (const p of prods) insSL.run(p.id, 50_000, p.cost, p.cost * 50);
const insCu = raw.prepare(`INSERT INTO customers (id, created_at, updated_at, hlc, name, price_tier) VALUES (?, 0, 0, 'h', ?, 'retail')`);
const insPB = raw.prepare(`INSERT INTO party_balances (party_type, party_id, balance_minor, last_activity_at) VALUES ('C', ?, ?, 0)`);
const insPL = raw.prepare(`INSERT INTO party_ledger (id, created_at, updated_at, party_type, party_id, source_type, source_id, debit_minor, credit_minor, business_day) VALUES (?, ?, ?, 'C', ?, 'sales_doc', ?, ?, 0, ?)`);
for (let i = 0; i < 1500; i++) {
  insCu.run(`c${i}`, `عميل ${i}`);
  insPB.run(`c${i}`, 10_000 + i);
}
const insD = raw.prepare(`INSERT INTO sales_docs (id, created_at, updated_at, type, status, number, customer_id, customer_name, price_tier, cashier_id, business_day, prices_include_vat, gross_minor, total_minor, net_minor, tax_minor, paid_minor, posted_at, original_doc_id) VALUES (?, ?, ?, ?, 'POSTED', ?, ?, ?, 'retail', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`);
const insL = raw.prepare(`INSERT INTO sales_lines (id, created_at, updated_at, doc_id, line_no, product_id, product_unit_id, name_snapshot, unit_name_snapshot, qty_milli, factor_milli, base_qty_milli, unit_price_minor, catalog_price_minor, gross_minor, line_discount_minor, invoice_discount_minor, tax_rate_bp, net_minor, tax_minor, total_minor, unit_cost_minor, business_day) VALUES (?, ?, ?, ?, ?, ?, 'pu', ?, 'قطعة', ?, 1000, ?, ?, ?, ?, 0, 0, 1400, ?, ?, ?, ?, ?)`);
const insM = raw.prepare(`INSERT INTO stock_movements (id, created_at, updated_at, product_id, warehouse_id, qty_milli, unit_cost_minor, type, source_type, source_id, business_day, occurred_at) VALUES (?, ?, ?, ?, 'w', ?, ?, 'SALE', 'sales_doc', ?, ?, ?)`);
let lines = 0;
for (let i = 0; i < INVOICES; i++) {
  const day = addDays(start, Math.floor((i / INVOICES) * 365));
  const at = i * 1000;
  const n = 3 + (i % 7); // 3..9 lines → ~6 avg
  let total = 0;
  const id = `d${i}`;
  const cust = i % 4 === 0 ? `c${i % 1500}` : null;
  const ls: unknown[][] = [];
  for (let k = 0; k < n; k++) {
    const p = prods[(i * 13 + k * 101) % prods.length]!;
    const q = 1000 * (1 + ((i + k) % 3));
    const gross = (p.price * q) / 1000;
    const net = Math.round(gross / 1.14);
    total += gross;
    ls.push([`${id}-${k}`, at, at, id, k + 1, p.id, `منتج رقم ${p.id}`, q, q, p.price, p.price, gross, net, gross - net, gross, p.cost, day]);
    if (k === 0) insM.run(`${id}-m`, at, at, p.id, -q, p.cost, id, day, at);
  }
  insD.run(id, at, at, 'INVOICE', `INV-A-${i}`, cust, cust ? 'عميل' : null, `u${i % 3}`, day, total, total, Math.round(total / 1.14), total - Math.round(total / 1.14), total, at, null);
  for (const l of ls) insL.run(...l);
  if (cust && i % 8 === 0) insPL.run(`pl${i}`, at, at, cust, id, Math.round(total / 3), day);
  lines += n;
  if (i % 20 === 0 && i > 0) {
    const rid = `r${i}`;
    const l0 = ls[0]!;
    insD.run(rid, at + 1, at + 1, 'RETURN', `RET-A-${i}`, cust, null, 'u0', day, l0[14], l0[14], l0[12], (l0[13] as number), l0[14], at + 1, id);
    insL.run(`${rid}-0`, at + 1, at + 1, rid, 1, l0[5], l0[6], l0[7], l0[8], l0[9], l0[10], l0[11], l0[12], l0[13], l0[14], l0[15], day);
    lines++;
  }
}
raw.exec('COMMIT');
raw.exec('ANALYZE');

console.log(`seeded ${INVOICES} invoices, ${lines} lines in ${((Date.now() - t0) / 1000).toFixed(1)} s`);

const time = async (name: string, f: () => Promise<unknown>) => {
  await f(); // warm-up (page cache), like a second open on the phone
  const s = performance.now();
  await f();
  const ms = performance.now() - s;
  console.log(`${ms < 1000 ? '✓' : '✗'} ${name.padEnd(34)} ${ms.toFixed(0).padStart(6)} ms`);
  return ms;
};
const month = { from: addDays(today, -29), to: today };
const year = { from: start, to: today };
(async () => {
  const tr = Date.now();
  await rebuildRollup(db);
  console.log(`roll-up rebuilt in ${Date.now() - tr} ms`);
  await time('dashboard', () => dashboard(db, today));
  for (const g of ['day', 'product', 'category', 'customer', 'user'] as const) {
    await time(`sales by ${g} (30 days)`, () => salesBy(db, g, month));
    await time(`sales by ${g} (full year)`, () => salesBy(db, g, year));
    await time(`sales by ${g} (mid-month → mid-month)`, () => salesBy(db, g, { from: addDays(start, 14), to: addDays(today, -10) }));
  }
  await time('discounts per user (year)', () => discountsByUser(db, year));
  await time('purchases by supplier (year)', () => purchasesBySupplier(db, year));
  await time('profit & loss (year)', () => profitAndLoss(db, year));
  await time('stock valuation', () => stockValuation(db));
  await time('stock movement p1 (year)', () => stockMovementFor(db, 'p1', year));
  await time('slow / dead stock (60 days)', () => slowStock(db, today, 60));
  await time('aging (customers)', () => aging(db, 'C', today));
  void sql;
})();
