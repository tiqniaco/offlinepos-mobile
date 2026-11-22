# Phase 6 — Backup, restore, subscriptions

Status: ✅ done in code · 🟡 = needs real phones / store accounts to confirm.

## Before starting
All suites green (245 tests).

## Delivered
- **Native feel** (owner request): native transitions, spring press, haptics, animated cart/sheets/toasts — see [../motion.md](../motion.md).
- **Backups**: encrypted `.obk`, automatic daily backup on the check-in, backup now, encrypted local copy, Excel of all data, retention by plan — see [../backup.md](../backup.md).
- **Restore / new phone**: cloud list → step-up OTP → decrypt & verify → preview → activate (old phone read-only) → restore.
- **Anchors**: chain + audit heads sent daily; server-signed receipts stored; integrity screen proves history before each anchor was not rewritten.
- **Subscriptions**: RevenueCat purchase/restore, webhook, activation codes, upgrade sheet at limits, sessions screen (remote sign-out) — see [../billing.md](../billing.md).
- **Admin**: dashboard (MRR, active, trials, churn, requests/day), activation codes (generate, revoke, CSV).
- **Ads**: real AdMob IDs injected at build time (test IDs until then); paid licence hides ads at the next start; server kill switch via the licence.

## Acceptance checklist
- [x] Full restore reproduces identical data (table dumps equal) and a verifiable chain — Node test with the real codec; 🟡 repeat on two emulators/phones.
- [x] Old device becomes read-only after the new device activates (next check-in) — API test.
- [x] Server requests per business/day measured over a 3-day simulated run: 1 Worker request/day (+1 direct R2 PUT) ≤ 5.
- [ ] 🟡 Backup of a 100k-invoice DB without UI freeze (< 100 ms blocks): codec bench 100 MB / 11 s, slowest 256 KB slice 54 ms on a laptop; phone uses 64 KB slices — measure on device.
- [x] Free plan: ads only online and only in allowed places (policy tests); paid licence hides ads; limits block only new records, with an upgrade sheet.
- [ ] 🟡 Store purchase end-to-end needs Play/App Store products + RevenueCat project.
- [x] Docs: backup/restore, billing & activation codes, ads placement rules (ads.md), store-rule decision (PLAN D-45/D-55).

## Tests
shared 126 · API 33 · mobile Jest 32 · mobile DB 66 · Android bundle 10 MB.
