CREATE TABLE `sales_rollup` (
	`month` integer NOT NULL,
	`dim` text NOT NULL,
	`key` text NOT NULL,
	`invoices` integer DEFAULT 0 NOT NULL,
	`qty_milli` integer DEFAULT 0 NOT NULL,
	`sales_minor` integer DEFAULT 0 NOT NULL,
	`net_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`disc_minor` integer DEFAULT 0 NOT NULL,
	`rets_minor` integer DEFAULT 0 NOT NULL,
	`cost_milli` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`dim`, `key`, `month`)
);
--> statement-breakpoint
CREATE INDEX `sales_rollup_month` ON `sales_rollup` (`dim`,`month`);--> statement-breakpoint
-- Backfill from posted sales (same formulas as domain/reports/rollup.ts).
INSERT INTO sales_rollup (month, dim, key, invoices, qty_milli, sales_minor, net_minor, tax_minor, disc_minor, rets_minor, cost_milli)
SELECT l.business_day / 100, 'P', l.product_id,
  count(DISTINCT CASE WHEN l.original_line_id IS NULL THEN l.doc_id END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.base_qty_milli),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.total_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.net_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.tax_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN l.offer_discount_minor + l.line_discount_minor + l.invoice_discount_minor ELSE 0 END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 0 ELSE l.total_minor END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * coalesce(l.unit_cost_minor, 0) * l.base_qty_milli)
FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id
WHERE d.status = 'POSTED' AND d.type IN ('INVOICE', 'RETURN') AND l.business_day IS NOT NULL
GROUP BY l.business_day / 100, l.product_id;
--> statement-breakpoint
INSERT INTO sales_rollup (month, dim, key, invoices, qty_milli, sales_minor, net_minor, tax_minor, disc_minor, rets_minor, cost_milli)
SELECT l.business_day / 100, x.dim, x.key,
  count(DISTINCT CASE WHEN l.original_line_id IS NULL THEN l.doc_id END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.base_qty_milli),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.total_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.net_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.tax_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN l.offer_discount_minor + l.line_discount_minor + l.invoice_discount_minor ELSE 0 END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 0 ELSE l.total_minor END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * coalesce(l.unit_cost_minor, 0) * l.base_qty_milli)
FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id
JOIN (SELECT id, 'C' AS dim, coalesce(customer_id, '') AS key FROM sales_docs UNION ALL SELECT id, 'U', coalesce(cashier_id, '') FROM sales_docs) x ON x.id = d.id
WHERE d.status = 'POSTED' AND d.type IN ('INVOICE', 'RETURN') AND l.business_day IS NOT NULL
GROUP BY l.business_day / 100, x.dim, x.key;
--> statement-breakpoint
INSERT INTO sales_rollup (month, dim, key, invoices, qty_milli, sales_minor, net_minor, tax_minor, disc_minor, rets_minor, cost_milli)
SELECT l.business_day / 100, 'D', CAST(l.business_day AS TEXT),
  count(DISTINCT CASE WHEN l.original_line_id IS NULL THEN l.doc_id END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.base_qty_milli),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.total_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.net_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * l.tax_minor),
  sum(CASE WHEN l.original_line_id IS NULL THEN l.offer_discount_minor + l.line_discount_minor + l.invoice_discount_minor ELSE 0 END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 0 ELSE l.total_minor END),
  sum(CASE WHEN l.original_line_id IS NULL THEN 1 ELSE -1 END * coalesce(l.unit_cost_minor, 0) * l.base_qty_milli)
FROM sales_lines l JOIN sales_docs d ON d.id = l.doc_id
WHERE d.status = 'POSTED' AND d.type IN ('INVOICE', 'RETURN') AND l.business_day IS NOT NULL
GROUP BY l.business_day;
