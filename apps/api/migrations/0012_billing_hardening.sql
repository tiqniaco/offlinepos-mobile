-- Pre-launch billing / backups / releases hardening (additive only).

-- Refresh-token grace: a lost check-in response may retry with the previous token once, within 2 minutes.
ALTER TABLE sessions ADD COLUMN prev_rotated_at INTEGER;
ALTER TABLE sessions ADD COLUMN prev_grace_used INTEGER NOT NULL DEFAULT 0;

-- Manual payments: client idempotency key, receipt fingerprint (duplicate detection), transfer reference,
-- and a per-approval nonce so the approve + plan activation happen in one D1 batch.
ALTER TABLE payment_requests ADD COLUMN idempotency_key TEXT;
ALTER TABLE payment_requests ADD COLUMN receipt_sha256 TEXT;
ALTER TABLE payment_requests ADD COLUMN reference TEXT;
ALTER TABLE payment_requests ADD COLUMN review_nonce TEXT;
CREATE UNIQUE INDEX payment_requests_idem ON payment_requests(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX payment_requests_receipt ON payment_requests(receipt_sha256);

-- Unsuspend restores the status the business had before the suspension.
ALTER TABLE businesses ADD COLUMN status_before_suspend TEXT;

-- Releases: sideload (APK from R2) vs store builds; a forced release only blocks after force_after (default created_at + 48 h).
ALTER TABLE app_releases ADD COLUMN channel TEXT NOT NULL DEFAULT 'sideload';
ALTER TABLE app_releases ADD COLUMN force_after INTEGER;
CREATE INDEX app_releases_channel ON app_releases(platform, channel, version_code);

-- Cleanup cron + backup retention helpers.
CREATE INDEX IF NOT EXISTS backups_uncommitted ON backups(committed_at, created_at);
CREATE INDEX IF NOT EXISTS ocr_scans_created ON ocr_scans(created_at);
CREATE INDEX IF NOT EXISTS otp_codes_created ON otp_codes(created_at);

-- «صلاحيات مخصصة» (custom_roles) is not built: drop it from every plan.
UPDATE plans SET features_json = (
  SELECT COALESCE(json_group_array(value), '[]') FROM json_each(plans.features_json) WHERE value != 'custom_roles'
) WHERE features_json LIKE '%custom_roles%';
