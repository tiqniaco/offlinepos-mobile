-- Delivery diagnostics for SMS codes: provider + its reply. Never the code, never credentials; phone is masked.
CREATE TABLE otp_send_log (
  id TEXT PRIMARY KEY,
  phone_masked TEXT NOT NULL,
  provider TEXT NOT NULL,
  ok INTEGER NOT NULL,
  detail TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX otp_send_log_at ON otp_send_log(at);
