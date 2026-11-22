# Phase 4 — Purchases, customers, suppliers, cash

Status: ✅ done in code · 🟡 = needs a real phone/printer to confirm.

## Before starting: regression of Phases 1–3
- All suites green before any new work (shared, API, mobile unit, mobile DB, Android bundle).
- Security review fixes: permission checks added to `deleteDraft`, `removeCountItem`, `discardCount`.
- Daily background integrity check on the home screen (owner/manager): a red alert if any posted record changed.

## Delivered
- **Customers & suppliers** (new tab): one list with balances, totals, search, filters (owe you / late / in credit), minimal form + "more", opening balance on create, soft delete only at zero balance.
- **Party card**: balance hero, one-tap actions (collect / pay, sell / buy, statement, WhatsApp, call), WhatsApp reminder for late customers (template in settings), last movements.
- **Account statement (كشف حساب)**: any range (presets + custom), opening balance, running balance, summary or detailed (items), totals; **WhatsApp / PDF / Excel / thermal print**.
- **Vouchers**: receipt from customer, refund to customer, payment to supplier, refund from supplier, expense, cash in/out, opening balance — immutable, chained, voidable (Manager/Owner) while the shift is open / same day.
- **Purchases**: purchase invoice (scan/search, cost & qty, discounts, incl./excl. VAT, default unpaid with due days), purchase returns (credit or cash), void; stock + moving-average cost + last cost updated.
- **Expenses**: categories (seeded), period totals per category, exports.
- **Cash shifts**: open with float, live expected cash, close with counted cash → over/short to the journal, Z report (WhatsApp/print/PDF), optional "require an open shift to sell".
- **Home quick actions**: collect, purchase, pay supplier, expense, statement, new customer, new product, shift; stats (today's sales, owed to you, low stock); late-customer and shift alerts.
- **WhatsApp everywhere**: invoice (sale done + invoice screen), statement, reminders, vouchers, purchase invoice, shift report.
- **AdMob prepared** (`features/ads`): policy (tested), UMP consent, banner slots in allowed places only, interstitial after exports (15-min cap, never first 2 min), "remove ads" link; Google test IDs until real IDs are set at build time. Paid plans and offline phones never see ads.
- **Compact, calm UI**: smaller type scale + text-size setting (small/medium/large), smaller icons/rows/buttons, tinted background instead of bare white.

## Acceptance checklist
- [x] Property test: party balance == Σ documents (statement closing) == Σ party_ledger == AR/AP journal sub-ledger, and Σ sub-ledgers == AR/AP control accounts — random sales, returns, voids, purchases, purchase returns, vouchers, opening balances (`purchases/phase4.db.test.ts`).
- [x] Statement correct for arbitrary ranges incl. opening balance (DB tests: full range, later range, single day).
- [ ] 🟡 Statement PDF visual check on a phone (HTML renders in the WebView; checked the same layout in the web preview and the thermal render).
- [x] Shift close: expected cash == float + Σ cash in − Σ cash out of the shift (test with sales + change, card/credit, receipt, expense, refund, cash out); difference posted to Cash over/short.
- [x] Tampering with vouchers, purchase lines and closed shifts is detected (test with triggers removed).
- [x] Docs updated.

## Tests
shared 110 · API 26 · mobile Jest 32 · mobile DB 54 · Android bundle builds (8.3 MB).

## Screenshots
`docs/screenshots/phase4-screens.png`, `phase4-statement-dark-thermal.png`, `phase4-compact-ui.png`.
