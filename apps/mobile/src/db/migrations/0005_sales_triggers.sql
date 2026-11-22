-- Posted sales documents are immutable (SPEC §4). Allowed after posting: print counters, and the single
-- POSTED → VOIDED transition (with its void fields). Corrections happen through returns or void entries.
CREATE TRIGGER sales_docs_posted_immutable BEFORE UPDATE ON sales_docs
WHEN OLD.status IN ('POSTED', 'VOIDED') AND OLD.type IN ('INVOICE', 'RETURN') AND (
  NEW.type IS NOT OLD.type OR NEW.number IS NOT OLD.number OR NEW.customer_id IS NOT OLD.customer_id OR NEW.customer_name IS NOT OLD.customer_name OR NEW.price_tier IS NOT OLD.price_tier OR NEW.original_doc_id IS NOT OLD.original_doc_id OR NEW.cashier_id IS NOT OLD.cashier_id OR NEW.issued_at IS NOT OLD.issued_at OR NEW.business_day IS NOT OLD.business_day OR NEW.prices_include_vat IS NOT OLD.prices_include_vat OR NEW.invoice_discount_json IS NOT OLD.invoice_discount_json OR NEW.gross_minor IS NOT OLD.gross_minor OR NEW.line_discount_minor IS NOT OLD.line_discount_minor OR NEW.invoice_discount_minor IS NOT OLD.invoice_discount_minor OR NEW.net_minor IS NOT OLD.net_minor OR NEW.tax_minor IS NOT OLD.tax_minor OR NEW.rounding_minor IS NOT OLD.rounding_minor OR NEW.total_minor IS NOT OLD.total_minor OR NEW.paid_minor IS NOT OLD.paid_minor OR NEW.credit_minor IS NOT OLD.credit_minor OR NEW.change_minor IS NOT OLD.change_minor OR NEW.cash_tendered_minor IS NOT OLD.cash_tendered_minor OR NEW.note IS NOT OLD.note OR NEW.approved_by IS NOT OLD.approved_by OR NEW.hash IS NOT OLD.hash OR NEW.prev_hash IS NOT OLD.prev_hash OR NEW.chain_seq IS NOT OLD.chain_seq OR NEW.posted_at IS NOT OLD.posted_at OR NEW.device_id IS NOT OLD.device_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.status IS NOT OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'VOIDED'))
  OR (OLD.status = 'VOIDED' AND (NEW.void_reason IS NOT OLD.void_reason OR NEW.voided_by IS NOT OLD.voided_by OR NEW.voided_at IS NOT OLD.voided_at))
)
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sales_docs_posted_no_delete BEFORE DELETE ON sales_docs
WHEN OLD.status IN ('POSTED', 'VOIDED') AND OLD.type IN ('INVOICE', 'RETURN')
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sales_lines_posted_immutable BEFORE UPDATE ON sales_lines
WHEN (SELECT status FROM sales_docs WHERE id = OLD.doc_id) IN ('POSTED', 'VOIDED')
 AND (SELECT type FROM sales_docs WHERE id = OLD.doc_id) IN ('INVOICE', 'RETURN')
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER sales_lines_posted_no_delete BEFORE DELETE ON sales_lines
WHEN (SELECT status FROM sales_docs WHERE id = OLD.doc_id) IN ('POSTED', 'VOIDED')
 AND (SELECT type FROM sales_docs WHERE id = OLD.doc_id) IN ('INVOICE', 'RETURN')
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
-- Payments: only the 'voided' flag may change (set when the document is voided).
CREATE TRIGGER payments_immutable BEFORE UPDATE ON payments
WHEN NEW.amount_minor IS NOT OLD.amount_minor OR NEW.method IS NOT OLD.method OR NEW.doc_id IS NOT OLD.doc_id
  OR NEW.party_id IS NOT OLD.party_id OR NEW.posted_at IS NOT OLD.posted_at OR NEW.kind IS NOT OLD.kind
  OR (OLD.voided = 1 AND NEW.voided = 0)
BEGIN
  SELECT RAISE(ABORT, 'payments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN
  SELECT RAISE(ABORT, 'payments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER party_ledger_no_update BEFORE UPDATE ON party_ledger
BEGIN
  SELECT RAISE(ABORT, 'party_ledger is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER party_ledger_no_delete BEFORE DELETE ON party_ledger
BEGIN
  SELECT RAISE(ABORT, 'party_ledger is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN
  SELECT RAISE(ABORT, 'journal_entries is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN
  SELECT RAISE(ABORT, 'journal_entries is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'journal_lines is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN
  SELECT RAISE(ABORT, 'journal_lines is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER integrity_chain_no_update BEFORE UPDATE ON integrity_chain
BEGIN
  SELECT RAISE(ABORT, 'integrity_chain is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER integrity_chain_no_delete BEFORE DELETE ON integrity_chain
BEGIN
  SELECT RAISE(ABORT, 'integrity_chain is append-only');
END;
--> statement-breakpoint
CREATE UNIQUE INDEX sales_docs_number ON sales_docs(number) WHERE number IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX accounts_system_key ON accounts(system_key) WHERE system_key IS NOT NULL;
--> statement-breakpoint
CREATE VIRTUAL TABLE customers_fts USING fts5(customer_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
