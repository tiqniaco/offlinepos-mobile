# Local data model & migrations (Phase 1)

Database: SQLite with **SQLCipher** encryption (`expo-sqlite`, `useSQLCipher: true`).
Key: random 256-bit, generated on first start, stored in Android Keystore / iOS Keychain
(`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). `src/db/client.ts` refuses to start if the build has no
SQLCipher (otherwise `PRAGMA key` would be silently ignored and data stored in clear).

## Conventions (PLAN.md §4.1)
- `id` = UUIDv7 text generated on the phone; `created_at`/`updated_at` = epoch ms;
  `created_by`, `device_id` on every row.
- Master data also has `hlc` (Hybrid Logical Clock, for future multi-device merge) and `deleted_at` (soft delete).
- Money = integer minor units; quantity = integer milli-units; rates = basis points.

## Phase 1 tables
| Table | Purpose |
|---|---|
| `business` | the single business on this phone (server id, name, country, type, currency, VAT) |
| `settings` | key → JSON value, seeded from the country/type profile (`packages/shared/src/profiles.ts`) |
| `devices` | this device (code A, B, …) |
| `doc_sequences` | per device & document type: prefix + next number → `INV-A-000123` |
| `roles` | Owner / Manager / Cashier (system) + custom later; permissions JSON + discount caps |
| `users` | name, role, scrypt PIN hash + salt + params, lock-out counters, biometric flag |
| `licence_state` | current licence token, last check-in, last server time, max seen time |
| `kv_meta` | device id/code and small internal values |
| `audit_log` | append-only, hash-chained audit entries |

## Audit log
`hash = SHA-256(canonical_json(entry) || prev_hash)`, genesis prev = 64 zeros.
The hashed fields are listed explicitly in `auditPayload()` — never hash the whole row object.
SQLite triggers (`0001_append_only_triggers.sql`) abort any UPDATE or DELETE.
The audit screen (More → سجل العمليات) recomputes the chain and shows where it breaks.

## Migrations
1. Edit `src/db/schema.ts`.
2. `pnpm db:generate` → new `src/db/migrations/NNNN_*.sql` + updated `migrations.js`.
3. Triggers / FTS / views: `npx drizzle-kit generate --custom --name <name>` and write SQL by hand.
4. Never edit a migration that has shipped. Migrations run automatically at app start.

## Phase 2 tables (products & inventory)
| Table | Purpose |
|---|---|
| `categories` | name, colour, sort (soft delete) |
| `units` | Arabic/English name, `allows_fraction` (kg yes, piece no); seeded with 10 standard units |
| `product_groups` | groups variants (size/colour); each variant is its own product row (D-06) |
| `products` | name, SKU (unique live), category, base unit, cost/retail/wholesale (minor), tax override, track stock/expiry, low-stock alert (milli), image path, soft delete |
| `product_units` | units a product is sold in; base row has `factor_milli = 1000`, a carton of 24 has 24000; optional price per unit |
| `barcodes` | code → product unit (unique among live rows); scanning a carton code adds a carton |
| `batches` | batch no. + expiry day (filled from purchases, Phase 4) |
| `warehouses` | one default warehouse in v1 |
| `stock_movements` | **append-only ledger** (triggers) — see `ledger.md` |
| `stock_levels` | cache: qty, moving-average cost, value per product+warehouse |
| `inventory_docs` / `inventory_lines` | OPENING / ADJUST / COUNT documents; posted = immutable (triggers) |
| `products_fts` | FTS5 index over Arabic-normalised name, English name, SKU, barcodes |

Indexes: see `0002_inventory.sql`; unique partial indexes `barcodes_code_live`, `products_sku_live`.

## Testing the database
`pnpm --filter @daftarak/mobile test:db` runs the real migrations on SQLite (better-sqlite3 through
Drizzle's sync driver — the same execution model as expo-sqlite) and exercises the domain services.

## Phase 3 tables (sales)
| Table | Purpose |
|---|---|
| `customers` | minimal (name, mobile, price tier, credit limit); full UI in Phase 4; `customers_fts` |
| `sales_docs` | INVOICE / RETURN / QUOTATION; DRAFT, PARKED, POSTED, VOIDED, CONVERTED; totals, payments summary, chain fields |
| `sales_lines` | snapshots (name, unit), qty & base qty, prices, discounts, VAT, totals, cost snapshot, original line (returns) |
| `payments` | money in/out per document (sale, refund; receipts etc. in Phase 4) |
| `party_ledger` / `party_balances` | append-only customer/supplier ledger + cached balance |
| `accounts`, `journal_entries`, `journal_lines` | background double-entry journal |
| `integrity_chain` | per-device hash chain of posted documents |
Triggers: `0005_sales_triggers.sql` (see posting.md).
