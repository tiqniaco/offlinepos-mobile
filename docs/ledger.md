# Stock ledger rules (Phase 2)

Code: `packages/shared/src/stock.ts` (pure math) · `apps/mobile/src/domain/inventory/ledger.ts` (DB).

1. **`stock_movements` is the only truth.** Append-only — SQLite triggers abort UPDATE/DELETE.
2. **Quantities are in base-unit milli-units** (`1 piece = 1000`, `1.25 kg = 1250`). A carton of 24 has
   `factor_milli = 24000`; selling/scanning one carton moves `24000` base milli.
3. **Every posting runs inside `withTx`** and updates the cache `stock_levels` in the same transaction.
4. **Moving weighted-average cost** (`applyMovement`):
   - inbound *with its own cost* (`OPENING`, `PURCHASE`, `SALE_RETURN`): `avg = (value + qty×cost) / (qty_before + qty)`;
     when stock was ≤ 0 the average resets to the inbound cost;
   - everything else (sales, adjustments, counts, returns to supplier) is valued at the current average
     (or the product's cost when there is no average yet). That value is stored on the movement.
5. **Negative stock:** setting `negativeStock` = `warn` (default, the UI warns) or `block`
   (`InventoryError('negative_blocked')`). Counts never block — the shelf is the truth.
6. **Documents:** opening stock, adjustments and counts are `inventory_docs` with lines. A posted document
   (`status = POSTED`, number `STK-A-000123`) and its lines are immutable (triggers). Hash-chaining of
   posted documents starts in Phase 3.
7. **Stock count (جرد):** only products that were counted change; difference = counted − system quantity
   *at posting time*.
8. **Rebuild:** `checkStockLevels()` replays the ledger and lists differences; `rebuildStockLevels()` replaces
   the cache. In the app: Products → ⋯ → "فحص أرصدة المخزون". A property test proves rebuild == cache
   for random sequences of purchases, sales, returns, adjustments and counts.

## Transactions (`src/db/withTx`)
Drizzle's expo-sqlite driver runs `db.transaction()` synchronously, so an `async` callback would commit
before its awaited statements run. **Never use `db.transaction(async …)`**. Use `withTx(db, async (tx) => …)`:
it issues `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` on the same connection and queues writers so two user
actions never interleave. Do not nest `withTx`.
