-- Stock ledger is append-only (PLAN.md §6 rule 1).
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock_movements is append-only');
END;
--> statement-breakpoint
-- Posted inventory documents (and their lines) are immutable (SPEC §4).
CREATE TRIGGER inventory_docs_posted_immutable BEFORE UPDATE ON inventory_docs
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_docs_posted_no_delete BEFORE DELETE ON inventory_docs
WHEN OLD.status = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_lines_posted_immutable BEFORE UPDATE ON inventory_lines
WHEN (SELECT status FROM inventory_docs WHERE id = OLD.doc_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER inventory_lines_posted_no_delete BEFORE DELETE ON inventory_lines
WHEN (SELECT status FROM inventory_docs WHERE id = OLD.doc_id) = 'POSTED'
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
-- A barcode identifies exactly one live product unit; SKU unique among live products.
CREATE UNIQUE INDEX barcodes_code_live ON barcodes(code) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX products_sku_live ON products(sku) WHERE deleted_at IS NULL AND sku IS NOT NULL;
--> statement-breakpoint
-- Full-text search over Arabic-normalised name, English name, SKU and barcodes (D-16).
-- Maintained by src/domain/inventory/search.ts in the same transaction as product changes.
CREATE VIRTUAL TABLE products_fts USING fts5(product_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
