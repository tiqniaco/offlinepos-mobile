# Excel / CSV product import

Products → ⋯ → "استيراد من Excel" (or the empty-state button).

1. **Template** (optional): "نزّل النموذج" shares an `.xlsx` with Arabic headers and one example row.
2. **Pick** any `.xlsx`, `.xls` or `.csv`. The first sheet is used; row 1 = headers.
3. **Map columns**: headers are recognised automatically in Arabic or English (`guessMapping`); every field
   can be re-mapped by tapping it. Only **name** is required.
4. **Preview**: valid rows vs. rows with errors, each error with its sheet row number and field.
5. **Import** in chunks of 250 rows (one transaction each) with a progress bar, then a report.

| Field | Arabic header (template) | Notes |
|---|---|---|
| name | الاسم | required, ≤ 120 chars |
| barcode | الباركود | Arabic digits OK; must be unique |
| sku | كود الصنف | unique among live products |
| category | القسم | created if missing |
| unit | الوحدة | matched by Arabic/English name, created if missing (default قطعة) |
| cost / retail_price / wholesale_price | سعر الشراء / سعر البيع / سعر الجملة | numbers, max 2 decimals; "15 ج.م", "1,250.50", "١٢٫٥" accepted |
| qty | الكمية | opening stock (posted as one OPENING document per chunk) |
| low_stock | حد الطلب | low-stock alert |
| larger_unit, larger_factor, larger_price, larger_barcode | الوحدة الكبيرة، عدد في العبوة، سعر العبوة، باركود العبوة | needs the `multi_unit` plan feature; factor must be > 1 |

Existing products (same barcode, else same SKU): **updated** (name, prices, cost, category, alert) when
"حدّث المنتجات الموجودة" is on, otherwise skipped. Plan limits apply: rows beyond the limit are reported, not lost.

Export (⋯ → "تصدير Excel") writes the same columns, so an export can be edited and re-imported.
Cost is exported only for users with `cost.view`.

Performance: 5,000 products (with stock, categories, larger units) import in **3.6 s** in the Node test
harness; the phone figure must be measured on a mid-range Android (acceptance criterion < 30 s).
