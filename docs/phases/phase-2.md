# Phase 2 — Products & inventory: acceptance checklist

Legend: ✅ done and verified here · 🟡 built, needs verification on a real phone / emulator
(no Android emulator in this cloud container) · ❌ not done

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Import 5,000 products in < 30 s on a mid-range Android | 🟡 | 3.6 s in the Node/SQLite harness (`inventory.db.test.ts`, incl. stock, categories, larger units). Chunked (250 rows/tx) with progress. Must be timed on a device. |
| 2 | Products list scrolls smoothly | 🟡 | FlashList + keyset pagination (40/page, never OFFSET) + indexed queries; FPS must be checked on device with 5k products. |
| 3 | Rebuilding stock from the ledger equals cached levels (test) | ✅ | Property test (25 random runs of purchases/sales/returns/adjustments/counts) + rebuild test + "repair corrupted cache" test |
| 4 | Everything works offline | ✅ / 🟡 | No inventory code touches the network (all local SQLite, SheetJS, camera, file sharing). Airplane-mode run on device pending. |
| 5 | Products, units/conversion, categories, variants | ✅ | `products.ts`, `catalog.ts`; tests for units, variants, categories filter |
| 6 | Barcode scan-to-fill; hardware scanner input | 🟡 | Camera scanner screen + keyboard-wedge input in search/count/form. Needs a device + real scanner. |
| 7 | Stock ledger + cached levels, append-only, posted docs immutable | ✅ | triggers tested (UPDATE/DELETE rejected) |
| 8 | Adjustments with reason; negative-stock policy | ✅ | tests: warn allows, block rejects and rolls back |
| 9 | Stock count by scanning | ✅ / 🟡 | domain tested (add/set/post, only counted items change); scanning UX on device pending |
| 10 | Low-stock list | ✅ | `lowStockOnly` filter + summary tested; chip on products tab, stat on home |
| 11 | Excel/CSV import (template, mapping, preview, row errors, report) & export | ✅ / 🟡 | validation + import + export round-trip tested; file picking/sharing on device pending |
| 12 | Bulk edit (price %, category) with confirmation | ✅ | tested (+10 % with rounding); confirmation dialog in UI |
| 13 | Soft delete with undo | ✅ | delete releases barcodes; undo restores unless the code was taken meanwhile (tested) |
| 14 | Docs updated | ✅ | `ledger.md`, `import-format.md`, `data-model.md`, `folder-map.md` |

Also fixed in this phase: **Phase 1 transaction bug** — see `ledger.md` → Transactions (D-30).

## Test totals
- `packages/shared`: 77 (Vitest) · `apps/api`: 26 (Vitest/workerd) · `apps/mobile`: 19 unit (Jest) + 23 database (Vitest/SQLite)
- Android JS bundle builds (7 MB Hermes).

## To close the 🟡 items on a device
1. `npx expo run:android` (dev build — the camera and SQLCipher need native code).
2. Import a 5,000-row sheet (export one from the test data or use the template) and note the time in the report.
3. Scroll the list, scan with the camera and with a USB/Bluetooth scanner, run a count, all in airplane mode.
