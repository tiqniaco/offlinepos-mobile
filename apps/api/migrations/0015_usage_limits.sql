-- Usage metering + per-business limit overrides (additive only).

-- One row per (business, Cairo day YYYYMMDD, metric). business_id '*' = global totals of the day.
-- count = events (or tokens for ocr_*_tokens); bytes = bytes moved, or for a "*_stored" gauge the current total.
CREATE TABLE usage_daily (
  business_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, day, metric)
) WITHOUT ROWID;
CREATE INDEX usage_daily_day ON usage_daily(day, metric);

-- Super-admin overrides of a plan limit for one business: effective limit = override ?? plan limit.
CREATE TABLE business_limit_overrides (
  business_id TEXT NOT NULL REFERENCES businesses(id),
  limit_key TEXT NOT NULL,
  value INTEGER NOT NULL,
  note TEXT,
  set_by TEXT,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (business_id, limit_key)
);

-- Existing plan rows get the new limits (seed values; other plans: the basic values, free plans: the free values).
UPDATE plans SET limits_json = json_set(limits_json, '$.sms_day', CASE WHEN code = 'pro' THEN 20 WHEN is_free = 1 THEN 5 ELSE 10 END)
  WHERE json_extract(limits_json, '$.sms_day') IS NULL;
UPDATE plans SET limits_json = json_set(limits_json, '$.backup_storage_mb', CASE WHEN code = 'pro' THEN 1024 WHEN is_free = 1 THEN 0 ELSE 150 END)
  WHERE json_extract(limits_json, '$.backup_storage_mb') IS NULL;
UPDATE plans SET limits_json = json_set(limits_json, '$.receipt_uploads_month', CASE WHEN code = 'pro' THEN 20 WHEN is_free = 1 THEN 5 ELSE 10 END)
  WHERE json_extract(limits_json, '$.receipt_uploads_month') IS NULL;
UPDATE plans SET limits_json = json_set(limits_json, '$.api_requests_day', CASE WHEN code = 'pro' THEN 15000 WHEN is_free = 1 THEN 2000 ELSE 5000 END)
  WHERE json_extract(limits_json, '$.api_requests_day') IS NULL;
UPDATE plans SET limits_json = json_set(limits_json, '$.devices', CASE WHEN code = 'pro' THEN 5 WHEN is_free = 1 THEN 1 ELSE 2 END)
  WHERE json_extract(limits_json, '$.devices') IS NULL;
