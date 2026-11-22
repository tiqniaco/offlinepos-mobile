-- Phase 5 report speed (bench: scripts/bench-reports.ts, 100k invoices / 600k lines).
-- Covering index: sales reports by day / product / category read only this index, no table rows.
CREATE INDEX sales_lines_report ON sales_lines (business_day, product_id, doc_id, original_line_id, base_qty_milli, total_minor, net_minor, tax_minor, unit_cost_minor, offer_discount_minor, line_discount_minor, invoice_discount_minor, name_snapshot);
--> statement-breakpoint
-- Small set of non-posted documents excluded from line reports.
CREATE INDEX sales_docs_status ON sales_docs (status, type);
