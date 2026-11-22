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
