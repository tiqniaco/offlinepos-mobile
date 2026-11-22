# Phase 3 — Sales & printing

Status: ✅ done in code · 🟡 = needs a real phone/printer to confirm.

## Delivered
- Scan-first POS (Sell tab): camera scan / USB-HID scanner / search; rescan → qty +1; carton barcodes; line sheet (qty, price, discount); invoice discount; customer pick/quick-add with balance + credit-limit note.
- Payment screen: cash (quick amounts, change), card, wallet (named wallets), bank, credit (آجل); split payments.
- Discounts capped by role; above cap → manager PIN on the same phone (audited).
- Held sales (park/resume), quotations (numbered, convert to sale).
- Invoices list + detail, reprint, A4 PDF + share (WhatsApp), returns (partial/full, cash or credit), void (Manager/Owner, same day).
- Immutable posting, per-device hash chain, background double-entry journal, audit — see [../posting.md](../posting.md).
- Bluetooth thermal printing as a raster image (58/80 mm), BLE (Android + iPhone) and Classic SPP (Android), printer setup + test print, receipt layout settings, auto-print, cash drawer, ZATCA Phase-1 QR (KSA) — see [../printing.md](../printing.md).
- Integrity check screen (More → فحص سلامة السجلات).

## Acceptance checklist
- [ ] 🟡 10-item sale with scanning in < 20 s — flow is 1 scan per item + 2 taps to pay; needs timing on a real phone.
- [ ] 🟡 Arabic prints correctly on a real 58 mm printer — verified by decoding the exact printer bytes back to an image (`docs/screenshots/phase3-thermal-simulated.png`, shaped Arabic, sharp QR); real printer pending.
- [x] Printer failure never loses a sale — printing starts only after commit; errors show a toast with "إعادة الطباعة".
- [x] Tampering detected (test) — edited invoice and deleted chain entry both caught with triggers removed (`sales.db.test.ts`).
- [x] Pricing tests pass — `packages/shared/test/pricing.test.ts` + property test on posting.
- [x] Docs updated — posting.md, printing.md, data-model, folder-map, PLAN.md D-36…D-40, SECURITY.md.

## Test totals
shared 103 · API 26 · mobile Jest 29 · mobile DB 40 · Android bundle builds.

## Screenshots
`docs/screenshots/phase3-pos.png`, `docs/screenshots/phase3-thermal-simulated.png`.
