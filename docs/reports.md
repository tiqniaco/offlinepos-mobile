# Reports (Phase 5)

Queries: `apps/mobile/src/domain/reports/reports.ts` · catalogue & ReportDoc builders: `features/reports/defs.ts`.
Every report uses the same screen (date filter → numbers → WhatsApp / PDF / Excel / print).

Dashboard: today's sales & profit, month, receivables / payables, 30-day chart, top sellers, low stock, stock value.
Reports: sales by day / product / category / customer / cashier, discounts per user, purchases, profit & loss (from the
journal), stock valuation, slow/dead stock, expiring items, customer & supplier aging, expenses, shifts. Stock movement
per product is on the product screen (`stockMovementFor`).

Gating: `reports.view`; profit columns need `profit.view`; stock valuation needs `cost.view`; P&L, cashier, discounts,
slow stock and aging need plan feature `adv_reports`; expiring needs `expiry`.

## Speed (acceptance: every report < 1 s at 100k invoices)
- `sales_rollup`: monthly totals per product (P), customer (C), cashier (U) and day (D), updated in the posting
  transaction (post +1, void −1), backfilled by migration 0011, rebuildable (`rebuildRollup`). Ranges read whole months
  from the roll-up and scan only the partial edge months from the lines.
- Covering index `sales_lines_report` for edge scans; return lines are recognised by `original_line_id`, so line scans
  don't join the documents.
- Tests: incremental roll-up == full rebuild; month results == line results.

`pnpm --filter @daftarak/mobile bench:reports` (Node 22 + better-sqlite3, 100,000 invoices / 604,994 lines, warm):

| Report | 30 days | full year | mid-month → mid-month |
|---|---|---|---|
| dashboard | 43 ms | | |
| sales by day | 29 ms | 40 ms | 43 ms |
| sales by product | 46 ms | 71 ms | 95 ms |
| sales by category | 45 ms | 73 ms | 93 ms |
| sales by customer | 62 ms | 85 ms | 97 ms |
| sales by cashier | 64 ms | 73 ms | 93 ms |
| discounts per user (year) | | 50 ms | |
| P&L / purchases / valuation / movement / slow / aging | ≤ 66 ms | | |

A mid-range Android is roughly 3–5× slower than this machine → ≤ 0.5 s expected. 🟡 To confirm on a real phone.

## Reconciliation (tests)
P&L gross profit == Σ line profit (net − cost snapshot); net sales == Σ line net; stock valuation == Inventory account.
