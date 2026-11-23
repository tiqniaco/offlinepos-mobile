-- Supplier invoice photo scans (OCR via the Claude API). Paid plans only, monthly quota = plans.limits_json.ocr_month
-- (-1 = unlimited, 0 = not in the plan). Only status 'ok' counts against the quota; 'failed' rows feed the rate limit.
CREATE TABLE ocr_scans (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','failed')),
  input_tokens INTEGER NOT NULL DEFAULT 0,       -- summed over every model call of this scan
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT,                                    -- model that produced the result (or the last one tried)
  calls_json TEXT                                -- [{model, in, out, outcome}] one entry per model call
);
CREATE INDEX ocr_scans_business ON ocr_scans(business_id, created_at);

-- Existing plan rows get the new limit (free 0, basic 30, pro 150; any other plan 0 until the super admin sets it).
UPDATE plans SET limits_json = json_set(limits_json, '$.ocr_month',
  CASE code WHEN 'basic' THEN 30 WHEN 'pro' THEN 150 ELSE 0 END)
WHERE json_extract(limits_json, '$.ocr_month') IS NULL;
