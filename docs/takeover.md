# Takeover guide (for a new developer)

Start here, in this order: `SPEC.md` (what), `PLAN.md` (how + every decision D-xx and why), `docs/architecture.md`,
`docs/folder-map.md`, `docs/dev-setup.md`, then `docs/phases/phase-1…7.md` (what was delivered, what still needs a phone).

**Golden rules (break these and data gets corrupted):**
1. Money = integer minor units, quantity = milli-units, rates = basis points; round only with `divRound`.
2. Every write goes through a domain service: permission → licence guard → `withTx` (never nest) → audit.
3. Posted documents never change: corrections are returns / voids / new entries. Triggers enforce it; the hash chain
   and daily server anchors detect it.
4. Stock changes only via `postMovements`; the cache must always equal the ledger (`checkStockLevels`).
5. Every financial document posts ONE balanced journal entry; reports read SQL aggregates (+ `sales_rollup`).
6. The phone makes ≤ 1 Worker request per day in normal use (check-in carries licence, anchor, backup).
7. Arabic first: every string in `i18n/ar.json` (and en), Latin digits, RTL-aware layouts, test on a real phone.

**Where things live:** shared pure logic `packages/shared` (pricing, offers, stock math, crypto, codec — unit-tested);
app domain `apps/mobile/src/domain` (DB-tested with better-sqlite3: `pnpm --filter @daftarak/mobile test:db`);
screens `apps/mobile/src/app` (Expo Router) + views `src/features`; Worker `apps/api` (Hono + D1 + R2, tests in
workerd); admin `apps/admin`.

**Adding a feature:** see `docs/adding-a-module.md`. Schema change → edit `src/db/schema.ts` → `pnpm db:generate` →
custom migration for triggers/backfills → DB tests → domain → screen → i18n → docs → PLAN.md decision if it deviates.

**Accounts you need access to:** GitHub, Cloudflare (Workers, D1, R2, Pages, Access), Expo/EAS, Google Play Console +
Google Cloud (Play Integrity service account), App Store Connect, RevenueCat, AdMob, SMS Misr.
