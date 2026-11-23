-- Invoice scans are claimed BEFORE the model is called: a 'pending' row is inserted atomically against the quota, the
-- per-minute rate and the per-business concurrency, then updated to 'ok' / 'failed'. Stale 'pending' rows (worker
-- killed mid-call) stop counting after a few minutes. idem_key + result_json let the app retry a scan (X-Idempotency-Key)
-- without a second charge; fallback = 1 when the expensive retry model was used (monthly cap per business).
CREATE TABLE ocr_scans_new (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','ok','failed')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  calls_json TEXT,
  idem_key TEXT,
  result_json TEXT,
  fallback INTEGER NOT NULL DEFAULT 0
);
INSERT INTO ocr_scans_new (id, business_id, account_id, created_at, status, input_tokens, output_tokens, model, calls_json, fallback)
  SELECT id, business_id, account_id, created_at, status, input_tokens, output_tokens, model, calls_json,
         CASE WHEN calls_json LIKE '%},{%' THEN 1 ELSE 0 END
  FROM ocr_scans;
DROP TABLE ocr_scans;
ALTER TABLE ocr_scans_new RENAME TO ocr_scans;
CREATE INDEX ocr_scans_business ON ocr_scans(business_id, created_at);
CREATE INDEX ocr_scans_idem ON ocr_scans(business_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ocr_scans_created ON ocr_scans(created_at);
