# Phase 5 — Offers & reports

Status: ✅ done in code · 🟡 = needs a real phone to confirm.

## Before starting
All suites green (222 tests) before any new work.

## Delivered
- Offers engine in `packages/shared` (percent, fixed, buy X get Y, quantity pricing, coupons) with the approved stacking rules — see [../offers.md](../offers.md).
- Offers at the POS: "offer" badge per line, savings row, coupon entry; re-applied at posting; stored, chained, immutable.
- Offers & coupons screens (list with running/stopped/ended, one switch to stop; one form for all types).
- Dashboard + 15 reports with date filter, PDF, Excel, print, WhatsApp — see [../reports.md](../reports.md).
- Monthly roll-up + covering index → every report < 100 ms at 100k invoices (bench).
- Home quick action "Reports"; More → Reports, Offers. Interstitial (free plan) only when leaving a report / after an export.

## Acceptance checklist
- [x] Every report < 1 s on a seeded DB with 100k invoices (~605k lines) — bench script + table in reports.md (Node proxy).
- [ ] 🟡 Same bench on a mid-range Android.
- [x] Offer combination matrix covered by tests: coupon + automatic offer, best-offer selection & ties, BXGY with multi-unit (pieces + carton), BXGY other product, quantity tiers across lines, expiry boundaries (inclusive business days), inactive, coupon errors, caps not counting offers, property test (300 runs).
- [x] P&L and stock valuation reconcile with the journal (test).
- [x] Docs updated.

## Tests
shared 123 · API 26 · mobile Jest 32 · mobile DB 64 · Android bundle 8.4 MB.
