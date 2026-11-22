-- Daftarak control-plane schema (Cloudflare D1). No business data lives here (SPEC rule 2).
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,            -- E.164 without "+"
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE otp_codes (
  id TEXT PRIMARY KEY,
  phone TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','step_up')),
  code_hash TEXT NOT NULL,               -- HMAC-SHA256(pepper, phone|purpose|code)
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  ip TEXT
);
CREATE INDEX otp_phone_created ON otp_codes(phone, created_at);

CREATE TABLE rate_counters (
  key TEXT NOT NULL,                     -- e.g. "otp-ip:1.2.3.4"
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  refresh_hash TEXT NOT NULL,
  prev_refresh_hash TEXT,                -- for refresh-token reuse detection
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoke_reason TEXT,
  step_up_until INTEGER,
  install_id TEXT,
  platform TEXT,
  model TEXT,
  app_version TEXT,
  ip TEXT
);
CREATE INDEX sessions_account ON sessions(account_id);

CREATE TABLE plans (
  code TEXT PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  monthly_egp INTEGER NOT NULL, monthly_sar INTEGER NOT NULL,
  yearly_egp INTEGER NOT NULL, yearly_sar INTEGER NOT NULL,
  limits_json TEXT NOT NULL,
  features_json TEXT NOT NULL,
  is_free INTEGER NOT NULL DEFAULT 0,
  trial_days INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE businesses (
  id TEXT PRIMARY KEY,
  owner_account_id TEXT NOT NULL REFERENCES accounts(id),
  name TEXT NOT NULL,
  country TEXT NOT NULL CHECK (country IN ('EG','SA')),
  type TEXT NOT NULL CHECK (type IN ('shop','trading')),
  vat_registered INTEGER NOT NULL DEFAULT 0,
  plan_code TEXT NOT NULL REFERENCES plans(code),
  status TEXT NOT NULL CHECK (status IN ('trial','active','past_due','suspended')),
  plan_expires_at INTEGER NOT NULL,
  backup_key_wrapped TEXT NOT NULL,      -- AES-256-GCM(BACKUP_WRAP_KEY, backup key)
  next_device_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  app_version TEXT
);
CREATE INDEX businesses_owner ON businesses(owner_account_id);
CREATE INDEX businesses_status ON businesses(status, plan_expires_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  code TEXT NOT NULL,                    -- A, B, … used in document numbers
  session_id TEXT REFERENCES sessions(id),
  install_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  model TEXT,
  app_version TEXT,
  activated_at INTEGER NOT NULL,
  deactivated_at INTEGER,
  last_checkin_at INTEGER,
  UNIQUE (business_id, code)
);
CREATE INDEX devices_business ON devices(business_id);

CREATE TABLE anchors (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  chain_seq INTEGER NOT NULL,
  chain_head TEXT NOT NULL,
  audit_seq INTEGER NOT NULL,
  audit_head TEXT NOT NULL,
  server_time INTEGER NOT NULL
);
CREATE INDEX anchors_device ON anchors(device_id, chain_seq);

-- Requests per business per day (budget measurement, SPEC rule 2).
CREATE TABLE request_counters (
  business_id TEXT NOT NULL,
  day INTEGER NOT NULL,                  -- yyyymmdd UTC
  count INTEGER NOT NULL,
  PRIMARY KEY (business_id, day)
);

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_settings (key, value) VALUES ('ads_enabled', 'true');

CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- PBKDF2-SHA256, 100k iterations (Workers maximum)
  password_salt TEXT NOT NULL,
  totp_secret TEXT NOT NULL,             -- base32
  totp_last_step INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  disabled_at INTEGER
);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  ip TEXT
);

CREATE TABLE admin_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details_json TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX admin_audit_at ON admin_audit(at);
