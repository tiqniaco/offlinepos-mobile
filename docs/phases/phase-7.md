# Phase 7 — Polish & release

Status: ✅ done in code · 🟡 = needs real phones / store accounts / CI secrets to confirm.

## Before starting
All suites green (257 tests).

## Delivered
- **Global search** (home 🔍): products (name with Arabic letter variants, barcode), customers & suppliers (name, phone
  typed locally or internationally, Arabic digits), invoices, purchases, vouchers, and actions ("مصروف", "طابعة"…).
- **Local notifications** (no server, no extra requests): 09:30 morning summary (late customers, supplier dues, out of /
  low stock), trial/grace ending (≤ 3 days), no backup for 7 days; tap opens the right screen; on/off in المظهر.
- **Sample data** (home → "جرّب ببيانات تجريبية"): 19 products in 4 categories with barcodes, 3 customers, 2 suppliers;
  one tap removes exactly what it added.
- **First-use tips** on home, POS, customers, reports (once per phone).
- **Dark mode, font choice, text size, sounds, motion** (earlier phases + this one): all in المظهر.
- **Device integrity**: Play Integrity decoded and checked on the server (app recognised, device integrity, request hash,
  freshness); App Attest objects recorded (verification = follow-up D-56); policy `log` (default) / `enforce`
  (sign-up & activation only — check-in never locks a shop out).
- **Performance**: SheetJS and QR loaded on first use (not at start); startup timing logged (`[startup] interactive in …ms`).
- **Screenshot blocking** (optional, القفل والأمان) on profit/cost/report/backup screens.
- **Release**: `eas.json` profiles (development, preview, e2e, production with auto-increment), `release.yml` (tag →
  signed AAB + IPA on EAS), OTA channel per profile; `e2e.yml` (Android emulator + Maestro, nightly).
- **Maestro suite** `.maestro/`: onboarding, sell in airplane mode, return offline, print failure keeps the sale,
  report offline + export, lock / wrong PIN / unlock.
- **Docs**: store listings AR/EN + privacy policy draft (`docs/store/`), release guide, takeover guide,
  ZATCA Phase 2 & Egypt e-receipt plans, SECURITY.md review.

## Acceptance checklist
- [ ] 🟡 Maestro E2E suite green incl. airplane-mode flows — flows + CI job written; needs an emulator run (not available here).
- [ ] 🟡 Signed release AAB/IPA built by CI — workflow + EAS profiles ready; needs `EXPO_TOKEN` and store accounts.
- [x] Store listings drafted (AR/EN).
- [ ] 🟡 Cold start < 2 s on the reference mid-range Android — heavy modules deferred, timing log in place; measure on the phone.
- [x] Docs complete (release guide, takeover guide).

## Tests
shared 126 · API 35 · mobile Jest 32 · mobile DB 69 · Android bundle builds.
