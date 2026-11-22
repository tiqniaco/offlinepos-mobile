-- Phase 4 immutability (same rules as sales: PLAN.md §7). Corrections = returns / void entries.
CREATE TRIGGER purchase_docs_posted_immutable BEFORE UPDATE ON purchase_docs
WHEN OLD.status IN ('POSTED', 'VOIDED') AND (
  NEW.type IS NOT OLD.type OR NEW.number IS NOT OLD.number OR NEW.supplier_id IS NOT OLD.supplier_id OR NEW.supplier_name IS NOT OLD.supplier_name OR NEW.supplier_ref IS NOT OLD.supplier_ref OR NEW.original_doc_id IS NOT OLD.original_doc_id OR NEW.issued_at IS NOT OLD.issued_at OR NEW.business_day IS NOT OLD.business_day OR NEW.due_day IS NOT OLD.due_day OR NEW.prices_include_vat IS NOT OLD.prices_include_vat OR NEW.gross_minor IS NOT OLD.gross_minor OR NEW.discount_minor IS NOT OLD.discount_minor OR NEW.net_minor IS NOT OLD.net_minor OR NEW.tax_minor IS NOT OLD.tax_minor OR NEW.total_minor IS NOT OLD.total_minor OR NEW.paid_minor IS NOT OLD.paid_minor OR NEW.credit_minor IS NOT OLD.credit_minor OR NEW.note IS NOT OLD.note OR NEW.shift_id IS NOT OLD.shift_id OR NEW.hash IS NOT OLD.hash OR NEW.prev_hash IS NOT OLD.prev_hash OR NEW.chain_seq IS NOT OLD.chain_seq OR NEW.posted_at IS NOT OLD.posted_at OR NEW.device_id IS NOT OLD.device_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.status IS NOT OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'VOIDED'))
  OR (OLD.status = 'VOIDED' AND (NEW.void_reason IS NOT OLD.void_reason OR NEW.voided_by IS NOT OLD.voided_by OR NEW.voided_at IS NOT OLD.voided_at))
)
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER purchase_docs_posted_no_delete BEFORE DELETE ON purchase_docs
WHEN OLD.status IN ('POSTED', 'VOIDED')
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER purchase_lines_posted_immutable BEFORE UPDATE ON purchase_lines
WHEN (SELECT status FROM purchase_docs WHERE id = OLD.doc_id) IN ('POSTED', 'VOIDED')
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER purchase_lines_posted_no_delete BEFORE DELETE ON purchase_lines
WHEN (SELECT status FROM purchase_docs WHERE id = OLD.doc_id) IN ('POSTED', 'VOIDED')
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER vouchers_immutable BEFORE UPDATE ON vouchers
WHEN NEW.type IS NOT OLD.type OR NEW.number IS NOT OLD.number OR NEW.party_type IS NOT OLD.party_type OR NEW.party_id IS NOT OLD.party_id OR NEW.party_name IS NOT OLD.party_name OR NEW.category_id IS NOT OLD.category_id OR NEW.category_name IS NOT OLD.category_name OR NEW.method IS NOT OLD.method OR NEW.label IS NOT OLD.label OR NEW.amount_minor IS NOT OLD.amount_minor OR NEW.sign IS NOT OLD.sign OR NEW.note IS NOT OLD.note OR NEW.business_day IS NOT OLD.business_day OR NEW.shift_id IS NOT OLD.shift_id OR NEW.posted_at IS NOT OLD.posted_at OR (OLD.hash IS NOT NULL AND (NEW.hash IS NOT OLD.hash OR NEW.prev_hash IS NOT OLD.prev_hash OR NEW.chain_seq IS NOT OLD.chain_seq)) OR NEW.device_id IS NOT OLD.device_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at
  OR (NEW.status IS NOT OLD.status AND NOT (OLD.status = 'POSTED' AND NEW.status = 'VOIDED'))
  OR (OLD.status = 'VOIDED' AND (NEW.void_reason IS NOT OLD.void_reason OR NEW.voided_by IS NOT OLD.voided_by OR NEW.voided_at IS NOT OLD.voided_at))
BEGIN
  SELECT RAISE(ABORT, 'vouchers are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER vouchers_no_delete BEFORE DELETE ON vouchers
BEGIN
  SELECT RAISE(ABORT, 'vouchers are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shifts_closed_immutable BEFORE UPDATE ON shifts
WHEN OLD.status = 'CLOSED' AND (NEW.number IS NOT OLD.number OR NEW.user_id IS NOT OLD.user_id OR NEW.user_name IS NOT OLD.user_name OR NEW.opened_at IS NOT OLD.opened_at OR NEW.opening_float_minor IS NOT OLD.opening_float_minor OR NEW.closed_at IS NOT OLD.closed_at OR NEW.closed_by IS NOT OLD.closed_by OR NEW.expected_cash_minor IS NOT OLD.expected_cash_minor OR NEW.counted_cash_minor IS NOT OLD.counted_cash_minor OR NEW.difference_minor IS NOT OLD.difference_minor OR NEW.summary_json IS NOT OLD.summary_json OR NEW.note IS NOT OLD.note OR NEW.business_day IS NOT OLD.business_day OR (OLD.hash IS NOT NULL AND (NEW.hash IS NOT OLD.hash OR NEW.prev_hash IS NOT OLD.prev_hash OR NEW.chain_seq IS NOT OLD.chain_seq)) OR NEW.device_id IS NOT OLD.device_id OR NEW.created_by IS NOT OLD.created_by OR NEW.created_at IS NOT OLD.created_at OR NEW.status IS NOT OLD.status)
BEGIN
  SELECT RAISE(ABORT, 'closed shift is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shifts_open_fields BEFORE UPDATE ON shifts
WHEN OLD.status = 'OPEN' AND (NEW.number IS NOT OLD.number OR NEW.user_id IS NOT OLD.user_id OR NEW.opened_at IS NOT OLD.opened_at OR NEW.opening_float_minor IS NOT OLD.opening_float_minor OR NEW.device_id IS NOT OLD.device_id OR NEW.business_day IS NOT OLD.business_day)
BEGIN
  SELECT RAISE(ABORT, 'shift opening is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER shifts_no_delete BEFORE DELETE ON shifts
BEGIN
  SELECT RAISE(ABORT, 'shifts are immutable');
END;
--> statement-breakpoint
CREATE UNIQUE INDEX purchase_docs_number ON purchase_docs (number) WHERE number IS NOT NULL;
--> statement-breakpoint
CREATE VIRTUAL TABLE suppliers_fts USING fts5(supplier_id UNINDEXED, body, tokenize = 'unicode61 remove_diacritics 2');
