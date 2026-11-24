-- Multi-user on one shop: cashier phones join by QR (role 'satellite'), push sealed sales, read the sealed catalog.
-- Device sessions belong to the shop owner's account but are limited to the sync endpoints + check-in.
ALTER TABLE sessions ADD COLUMN device_business_id TEXT;

CREATE TABLE device_invites (
  code_hash TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  created_by_device TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_device_id TEXT
);
CREATE INDEX device_invites_business ON device_invites(business_id, created_at);

-- Sealed operations (sales…) from cashier phones, waiting for the main phone. Deleted a few days after applied.
CREATE TABLE sync_ops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  applied_at INTEGER,
  UNIQUE (device_id, seq)
);
CREATE INDEX sync_ops_business ON sync_ops(business_id, applied_at, id);

-- Sealed catalog (one per shop, in R2 at sync/<business>/catalog); version = upload time.
CREATE TABLE sync_state (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  catalog_version INTEGER NOT NULL DEFAULT 0,
  catalog_size INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
