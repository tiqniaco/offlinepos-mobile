-- Phase 6: cloud backups, activation codes, store billing (RevenueCat), key-release audit.
CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  device_id TEXT NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  counts_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto','manual')),
  created_at INTEGER NOT NULL,
  committed_at INTEGER
);
CREATE INDEX backups_business ON backups(business_id, committed_at);

CREATE TABLE key_releases (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  ip TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE activation_codes (
  code TEXT PRIMARY KEY,                 -- XXXX-XXXX-XXXX (no ambiguous letters)
  plan_code TEXT NOT NULL REFERENCES plans(code),
  days INTEGER NOT NULL,
  batch TEXT NOT NULL,
  note TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  redeemed_at INTEGER,
  redeemed_business_id TEXT,
  revoked_at INTEGER
);
CREATE INDEX activation_codes_batch ON activation_codes(batch);

CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,                   -- RevenueCat event id (idempotency)
  business_id TEXT,
  type TEXT NOT NULL,
  product_id TEXT,
  plan_code TEXT,
  expires_at INTEGER,
  raw_json TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX billing_events_business ON billing_events(business_id, received_at);

ALTER TABLE businesses ADD COLUMN plan_source TEXT NOT NULL DEFAULT 'trial';  -- trial | store | code | admin
ALTER TABLE businesses ADD COLUMN billing_period TEXT;                        -- monthly | yearly (store)
