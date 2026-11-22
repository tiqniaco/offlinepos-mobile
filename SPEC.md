# SPEC — Arabic-first, Offline-first Mobile App for Shops (Inventory · Invoices · Customers · Suppliers)

> Read this whole file before writing any code. It is the single source of truth for the project.
> If something here is unclear or contradicts itself, stop and ask — do not guess on architecture.

You are a senior mobile architect. Build a production-grade **mobile-only** app (Android first, iOS second)
for small shops and trading businesses in **Egypt and Saudi Arabia**.

## 0. The three rules that decide every trade-off
1. **The phone is the system.** Everything (selling, stock, customers, reports, printing, PDF) runs fully
   on the device with zero internet. Internet is never required for daily work.
2. **Near-zero server load.** The server only does: sign-up/OTP, subscription licence, backup storage,
   integrity anchoring, super admin. No business data is processed on the server. Target budget:
   **≤ 5 requests per business per day** in normal use.
3. **Simple, fast, beautiful.** A shop owner with no tech background makes his first sale in under
   5 minutes. Any common action ≤ 3 taps. Adding a product/customer/sale takes seconds.

## 1. What needs internet (and nothing else does)
| Need | When | Why |
|---|---|---|
| Sign-up / login with OTP | First install, new device | Verify phone number |
| Licence refresh | Once a day when online (background) | Subscription & trial status |
| Subscription purchase | When subscribing | Store billing (Google Play / App Store) |
| Backup upload | Daily, automatic, Wi-Fi preferred | Protect data, move to a new phone |
| Integrity anchor | Piggybacks on licence refresh | Tamper evidence (see §6) |
| Future: ZATCA / Egypt e-receipt | Later phase | Device submits directly to the authority |

WhatsApp sharing, PDF, printing, barcode scanning, reports: **all offline**, using the phone itself.

## 2. Tech stack (justify any change in PLAN.md)
**App**
- Expo (React Native) + TypeScript, Expo Router, development builds (not Expo Go — native modules needed).
- Local DB: SQLite via `expo-sqlite` **with SQLCipher encryption**, Drizzle ORM + versioned migrations.
- DB key: random 256-bit key stored in Keychain/Keystore via `expo-secure-store`; app unlocked by PIN or
  biometrics (`expo-local-authentication`). Auto-lock after inactivity (configurable, default 5 min).
- UI: NativeWind (Tailwind), FlashList for long lists, Zustand for UI state, react-hook-form + Zod.
- i18n: i18next, **Arabic RTL default**, English second. Font: IBM Plex Sans Arabic.
- Camera barcode: `react-native-vision-camera` (fast, continuous scanning). Hardware scanners work as keyboard input.
- PDF: `expo-print` (HTML → PDF, Arabic shaping works). Sharing: `expo-sharing` + `wa.me` deep link.
- Excel/CSV import & export on device: SheetJS.
- Money: **integer minor units** (piasters / halalas) everywhere. Never floats. One shared rounding function.

**Server (minimal, serverless)**
- Cloudflare Workers (Hono) + D1 (accounts, plans, licences, anchors) + R2 (encrypted backup blobs).
- Backups upload/download **directly to R2 via presigned URLs** — the Worker never streams the file.
- OTP provider behind an interface: SMS Misr (default), Twilio, WhatsApp Cloud API.
- Store billing via RevenueCat (Google Play Billing + Apple IAP). Webhook → updates licence in D1.
  Reason: selling a digital subscription inside the app must go through store billing or the app risks
  rejection. Add a manual "activation code" path for subscriptions sold offline by sales reps (super admin
  generates codes); check the current store rules before release and note the decision in PLAN.md.
- Super admin: small web app (React + Vite) on Cloudflare Pages, separate login with 2FA (TOTP).

**Monorepo**: `apps/mobile`, `apps/admin`, `apps/api`, `packages/shared` (Zod schemas, pricing engine,
money/rounding, tax, types — used by app and server).

**Testing**: Vitest (shared logic, ledger, pricing, tax), Jest + React Native Testing Library (screens),
Maestro (E2E on Android emulator, airplane mode scenarios), Miniflare for the Worker.

## 3. Printing (core feature, not an add-on)
- Thermal 58mm & 80mm over **Bluetooth**, plus A4 via the system print dialog / PDF.
- Arabic on thermal printers: **render the receipt as an image and print it as ESC/POS raster**
  (`GS v 0`). Do NOT rely on printer code pages — Arabic shaping breaks on most cheap printers.
  Flow: receipt React view → bitmap (`react-native-view-shot`) → monochrome dither → ESC/POS raster → send.
- Connectivity:
  - Android: Bluetooth Classic (SPP) **and** BLE. Handle Android 12+ `BLUETOOTH_CONNECT/SCAN` permissions.
  - iOS: **BLE printers only** (iOS doesn't support Bluetooth Classic SPP for non-MFi devices).
    Show a clear "supported printers" note in iOS settings.
  - Android POS devices with built-in printers (Sunmi etc.): pluggable printer driver interface, Sunmi driver in a later phase.
- Printer setup screen: scan → pick → test print → save as default. Auto-reconnect. Paper width setting.
- Templates: logo, business name, address, phones, tax number, QR code (ZATCA-format TLV QR for KSA),
  footer note, toggle columns (tax, discount, customer balance). Cash drawer kick command (ESC p).
- Print must never block the sale: if the printer fails, the sale is saved and "reprint" is one tap.

## 4. Data model rules
- Every row: `id` (UUIDv7, generated on device), `created_at`, `updated_at`, `created_by`, `device_id`.
- **Stock is an append-only ledger** (`stock_movements`): sale, purchase, return, adjustment, count, transfer.
  Current stock = sum of movements (maintain a cached `stock_levels` table updated in the same transaction,
  rebuildable from the ledger at any time).
- **Negative stock policy**: setting per business — "allow with warning" (default) or "block".
- **Posted documents are immutable** (invoices, returns, payments, receipts). Corrections only via
  return / credit note / void-with-reason. Drafts and quotations are editable.
- Numbering: `{prefix}-{device}-{seq}` e.g. `INV-A-000123` — device code included now so multi-device
  can be added later without renumbering.
- Soft delete only for master data (products, customers, suppliers), with undo.
- Background **double-entry journal** for every financial document (cash, sales, purchases, receivables,
  payables, inventory, VAT, expenses). Not exposed as an accounting UI in v1, but reports read from it.
- Schema designed so multi-device sync can be added later (see §8) without migration pain.

## 5. Modules (v1)
**Onboarding** — phone + OTP → business name → country (EG / SA) → type (shop / trading company) →
currency & VAT auto-set (EG 14%, SA 15%) → optional sample data → first sale. The whole app (texts, print
templates, tax, features shown) is driven by country + type. Nothing hardcoded.

**Products & inventory** — name, barcode (scan to fill), SKU, category, unit + larger unit with conversion
(piece/carton), cost, retail & wholesale price, optional variants, optional expiry/batch, image (stored
locally, compressed), low-stock threshold. Stock adjustments with reason, stock count screen (scan-driven).
Excel/CSV import: template download, column mapping, preview, row-level errors, report. Export to Excel.
Bulk edit (price %, category) with confirmation. One warehouse in v1 (data model supports more).

**POS / sales** — scan-first POS: scanning the same item increments quantity, last item on top, search by
name/barcode, quick qty edit, customer optional (walk-in default). Payments: cash, card, wallet
(Vodafone Cash / InstaPay / STC Pay), bank transfer, credit (deferred), split. Item & invoice discounts
capped per role. Hold/park sale. Print or share PDF on WhatsApp right after payment. Quotations,
sales returns (linked to the original invoice).

**Purchases** — purchase invoices (default: unpaid), purchase returns, supplier payments.

**Customers & suppliers** — name, mobile, address only on the main form (email, tax number, credit limit
under "more"). Balance, credit limit warning, payments/receipts, account statement (كشف حساب) for any
date range → PDF → WhatsApp, overdue reminder message template.

**Expenses & cash** — expense categories, cash shift open/close with expected vs. actual cash.

**Users on one device** — Owner, Manager, Cashier (+ custom roles). Quick switch with a 4–6 digit PIN.
Cashier can't change prices, can't exceed discount limit, can't void, can't see cost/profit.

**Offers** — percentage/fixed, date range, buy X get Y, quantity pricing, coupon codes. One shared,
pure pricing engine in `packages/shared` with exhaustive unit tests.

**Reports (all on device)** — dashboard (today's sales, profit, top items, low stock, receivables/payables,
30-day chart); sales by day/product/category/customer/user; purchases; profit & loss; stock valuation;
stock movement per product; slow/dead stock; expiring items; aging; expenses; shifts; discounts per user.
Each: date filter, PDF, Excel, print. Use indexed SQL aggregates — must stay fast at 100k invoices.

## 6. Security & anti-tampering (on a device the user owns)
Be honest in PLAN.md: a rooted phone can be tampered with. The goal is **tamper-evidence**, not magic.
- Encrypted DB (SQLCipher), key in Keychain/Keystore, PIN/biometric unlock, auto-lock, screenshot block
  on sensitive screens (optional setting).
- **Hash chain**: each posted document stores `hash = SHA-256(canonical_json(doc) + prev_hash)`.
  Separate chain per device. Same structure ZATCA uses (previous invoice hash), so KSA integration reuses it.
- **Anchoring**: with each daily licence refresh, send `{device_id, chain_head_hash, doc_count}` (~200 bytes).
  The server keeps the history. The integrity screen re-computes the chain locally and compares with the
  last anchors → shows "intact" or exactly where it breaks.
- Append-only **audit log** (who, what, when, before/after) for price changes, discounts, voids, returns,
  stock adjustments, role/permission changes, restores. Also hash-chained. No UI to edit or delete it.
- Licence: server issues a token signed with **Ed25519** `{tenant, plan, limits, features, expires_at,
  grace_until}`; the app verifies offline with the embedded public key. Offline grace: 7 days after
  expiry → read-only mode (never delete data, export always allowed).
- Clock tampering: store the highest time ever seen; if device time goes back more than 24h,
  require an online licence check before creating new documents.
- Server: Zod validation, rate limits on OTP (per phone + per IP), OTP 6 digits, 5-min expiry, 5 attempts,
  60s resend cooldown, hashed in D1. Short-lived access tokens + rotating refresh tokens in secure storage.
  Session list per account with remote revoke (takes effect at next licence refresh). Secrets only in env.
  Play Integrity / App Attest on sign-up and licence calls (later phase).
- `SECURITY.md` checklist, `npm audit` + dependency review in CI.

## 7. Backup, restore, new phone
- Backup = consistent SQLite snapshot → compressed → encrypted (AES-256-GCM) on device → uploaded straight
  to R2. Daily automatic when online (Wi-Fi preferred), plus manual "backup now".
- Backup key: generated per business, stored on the server wrapped with a server secret, released only to an
  authenticated owner session (OTP). So a lost phone never means lost data, and the owner never manages keys.
- Restore / move to a new phone: login with OTP → list backups (date, size, invoice count) → preview →
  confirm with OTP → restore. Old device is deactivated (single active device in v1).
- Retention per plan (e.g. last 7 / 30 daily). Local export: encrypted file + Excel of main data, anytime.

## 8. Multi-device (NOT in v1 — design for it)
v1 = one active device per business. Later, as a paid add-on: devices exchange encrypted operation logs
through R2 (server stores blobs only, no processing). Rules ready now: UUIDv7 ids, device-coded numbering,
ledger-based stock and balances (additive merge), field-level last-write-wins for master data using a
**Hybrid Logical Clock** (never raw device time). Do not build the sync engine in v1.

## 9. SaaS & super admin
- Plans: price monthly/yearly, limits (users on device, products, invoices/month), feature flags
  (offers, multi-unit, expiry tracking, advanced reports…). Limits enforced on device from the signed
  licence, with friendly upgrade prompts.
- Trial: automatic on sign-up, days set per plan, in-app banner with remaining days, reminders, then
  read-only (never delete data).
- Super admin: businesses list (status, plan, last seen, backups, app version), extend trial, change plan,
  suspend, activation codes, coupons, store subscription status from RevenueCat, dashboard
  (MRR, active, trials, churn). Every admin action audit-logged.

## 10. UX & design rules
- Mobile-first, one-hand use, big touch targets, works on small Android phones (360dp) and tablets.
- Calm light colours, subtle gradients, soft shadows, colourful duotone icons. **No purple. Must not look
  AI-generated or template-made.** Dark mode later.
- No clutter: few cards, few buttons, no "Add X" menu items — adding lives in each list's + button and a
  global quick-add. Summary cards are tappable and open their details.
- Friendly Egyptian/Gulf-neutral Arabic copy, friendly empty states with the right action button, clear
  Arabic error messages. Optimistic, instant UI; cold start < 2s on a mid-range Android.

## 11. Documentation (mandatory with every phase)
`docs/` must let a non-expert developer take over: architecture, folder map ("what is where, what links to
what"), data model & migrations, ledger and hash-chain rules, licence flow, printing pipeline, how to add a
module, how to release to the stores, API reference for the Worker. Update docs in the same commit as code.

## 12. Working rules
- First output: `PLAN.md` (architecture, data model ERD, licence & backup flows, security model, decisions
  with reasons, risks, phased roadmap with acceptance criteria). Wait for approval before Phase 1.
- Small commits per feature, tests passing. Each phase ends with its acceptance checklist ticked.
- No feature outside this spec without asking. No placeholder/fake implementations marked as done.

---

# HOW TO WORK THROUGH THIS FILE
Execute the phases below in order. Start with Phase 0 only. After each phase, tick its acceptance checklist,
commit, report to me, and wait for my "continue" before starting the next phase.

## Phase 0 — Plan
Read `SPEC.md` fully. Do not write app code yet.
Create `PLAN.md`: architecture diagram, data model (tables, key fields, indexes), stock ledger rules,
hash-chain + anchoring flow, licence flow (Ed25519, offline grace, clock-rollback check), backup/restore
flow, printing pipeline, server endpoints with expected requests per business per day, risks, and the
phased roadmap with acceptance criteria. List every decision where you deviate from SPEC.md and why.
End with open questions for me. Stop and wait for approval.

## Phase 1 — Foundation
Implement Phase 1 per SPEC.md and PLAN.md:
monorepo, Expo app shell (RTL Arabic, i18n, fonts, design tokens, base components), encrypted SQLite +
Drizzle migrations, PIN/biometric lock + auto-lock, roles & PIN user switching, Cloudflare Worker with
OTP sign-up/login (SMS Misr provider behind interface), signed licence + trial, onboarding
(country + type drives settings), minimal super admin (login with 2FA, plans, businesses, extend trial).
Acceptance: fresh install → OTP → onboarding → home in < 60s; app works in airplane mode after first login;
licence verified offline; expired licence → read-only; tests for licence & OTP limits pass; docs updated.

## Phase 2 — Products & inventory
Implement products, units/conversion, categories, barcode scan-to-fill, stock ledger + cached levels,
adjustments, stock count by scanning, low-stock list, Excel/CSV import (template, mapping, preview, errors,
report) and export, bulk edit.
Acceptance: import 5,000 products in < 30s on a mid-range Android; list scrolls smoothly; rebuilding
stock from the ledger equals cached levels (test); everything works offline; docs updated.

## Phase 3 — POS, sales & printing
Implement scan-first POS, payments (incl. split & credit), discounts with role caps, park sale,
quotations, sales returns, immutable posting + hash chain + audit log, background journal entries,
Bluetooth thermal printing via image→ESC/POS raster (58/80mm, Classic + BLE on Android, BLE on iOS),
printer setup & test print, A4 PDF, WhatsApp share, reprint.
Acceptance: a 10-item sale with scanning in < 20s; Arabic prints correctly on a real 58mm printer;
printer failure never loses a sale; tampering with a stored invoice is detected by the integrity check
(test); pricing engine tests pass; docs updated.

## Phase 4 — Purchases, customers, suppliers, cash
Purchase invoices & returns, customers & suppliers (minimal forms), balances, credit limit, receipts &
payments, account statement PDF → WhatsApp, overdue reminder template, expenses, cash shifts.
Acceptance: customer balance always equals the sum of its documents (test); statement PDF correct in
Arabic for any date range; docs updated.

## Phase 5 — Offers & reports
Offers (all types in SPEC §5) in the shared pricing engine; dashboard + all reports with PDF/Excel/print.
Acceptance: every report < 1s on a seeded DB with 100k invoices; offer combinations covered by tests; docs updated.

## Phase 6 — Backup, restore, subscriptions
Encrypted daily backup direct to R2, manual backup, restore with preview + OTP, move to new phone
(old device deactivated), retention per plan, local export; RevenueCat billing + webhook, activation codes,
upgrade prompts at limits, chain anchoring on licence refresh, integrity screen, super admin dashboard
(MRR, active, trials, churn), session revoke.
Acceptance: full restore on a second emulator reproduces identical data and chain; server requests per
business/day measured and ≤ 5; docs updated.

## Phase 7 — Polish & release
Onboarding sample data, in-app tips, global search, notifications (low stock, due payments, trial ending),
dark mode, font size, performance pass, Play Integrity/App Attest, store listings & release builds,
SECURITY.md review. Prepare (don't build) ZATCA Phase 2 and Egypt e-receipt integration plans.
Acceptance: Maestro E2E suite green (incl. airplane-mode flows); release builds signed; docs complete.
