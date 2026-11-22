# Printing pipeline (Phase 3)

Code: `apps/mobile/src/features/printing/`, encoder in `packages/shared/src/escpos.ts`.

```
posted sale → buildReceiptData() → <ReceiptView dots=384|576> (off-screen, PrintHost)
  → react-native-view-shot PNG, exactly `dots` pixels wide → fast-png decode → RGBA
  → gray → threshold (text) → pack bits → ESC/POS: ESC @ · center · GS v 0 bands (128 rows) · feed · cut · [drawer]
  → driver.write()  (BLE: ble-plx, MTU-sized chunks, paced · Classic SPP: react-native-bluetooth-classic)
```
Arabic is drawn by the phone as an image, so shaping never depends on printer code pages (SPEC §3).
`ReceiptView` is designed in printer dots (black on white, no theme colours); 58 mm = 384 dots, 80 mm = 576
(512 for printers with a 72 mm print area).

## Settings (More → الطابعات)
Scan (Android: Classic + BLE; iPhone: BLE only, with a note) → pick → paper width → **test print** → set default.
Options: auto-print after each sale, open cash drawer (`ESC p 0 25 250`), copies. Saved per phone in `settings.printer`.
Receipt layout (الطابعات → شكل الفاتورة): logo, address, phones, footer, show VAT / discounts / customer balance.
KSA + VAT-registered: ZATCA Phase-1 TLV QR on every receipt and PDF.

## Never lose a sale
Printing runs after commit. Errors (`PrintError`: permission, bluetooth_off, connect, write, render, unsupported)
show a toast with **إعادة الطباعة**; invoice detail always has "إعادة الطباعة". `print_count` increments only on success.

## PDF / WhatsApp
`sharePdf()` renders an A4 HTML invoice (Readex Pro embedded, TIQNIA-blue header row) with expo-print and opens the
share sheet — WhatsApp is one tap there (`wa.me` links can't carry files; PLAN.md D-08).

## Verifying without a printer
`npx tsx packages/shared/test/thermal-sim.ts receipt.png out.png 384` runs a receipt image through the real
encoder and decodes the printer bytes back into the 1-bit image the printer would print
(`docs/screenshots/phase3-thermal-simulated.png`). Real-printer checks are still required (Phase 3 acceptance).

## Adding a printer type (e.g. Sunmi built-in)
Implement `PrinterDriver` (`types.ts`) in `drivers/`, return it from `driverFor()`/`platformDrivers()`.
