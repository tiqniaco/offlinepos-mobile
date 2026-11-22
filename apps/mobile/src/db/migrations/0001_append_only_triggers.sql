-- Append-only guarantees for the audit log (PLAN.md §4.1, §7.4). There is no code path that edits
-- or deletes audit rows; these triggers make sure even a bug cannot.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
