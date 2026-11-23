-- Security hardening (additive only).

-- Trial farming: the account's single trial is claimed atomically (UPDATE … WHERE trial_used_at IS NULL).
ALTER TABLE accounts ADD COLUMN trial_used_at INTEGER;
UPDATE accounts SET trial_used_at = (SELECT MIN(created_at) FROM businesses WHERE owner_account_id = accounts.id)
  WHERE EXISTS (SELECT 1 FROM businesses WHERE owner_account_id = accounts.id);

-- Refresh-token grace hardening (auth/tokens.ts):
--  orphan_refresh_hash = the live token that a grace refresh superseded (presenting it later revokes the session);
--  current_used_at     = when the live token was first presented (a used token disables the grace path);
--  refresh_history     = space-separated hashes of older rotated-away tokens (presenting one revokes the session).
ALTER TABLE sessions ADD COLUMN orphan_refresh_hash TEXT;
ALTER TABLE sessions ADD COLUMN current_used_at INTEGER;
ALTER TABLE sessions ADD COLUMN refresh_history TEXT;

-- Manual entitlement (activation code / manual payment / admin) kept apart from the store plan: a store purchase
-- or its expiry / refund never wipes paid manual time (routes/phase6.ts RevenueCat webhook).
ALTER TABLE businesses ADD COLUMN manual_plan_code TEXT;
ALTER TABLE businesses ADD COLUMN manual_until INTEGER;
UPDATE businesses SET manual_plan_code = plan_code, manual_until = plan_expires_at
  WHERE plan_source IN ('manual', 'code', 'admin') AND plan_code != 'free';

-- OCR idempotency: one scan row per (business, key); the mode is part of the stored key ("list:" prefix).
-- Older duplicates (pre-index) lose their key so the unique index can be built.
UPDATE ocr_scans SET idem_key = NULL
  WHERE idem_key IS NOT NULL AND rowid NOT IN (SELECT MAX(rowid) FROM ocr_scans WHERE idem_key IS NOT NULL GROUP BY business_id, idem_key);
CREATE UNIQUE INDEX ocr_scans_idem_unique ON ocr_scans(business_id, idem_key) WHERE idem_key IS NOT NULL;
