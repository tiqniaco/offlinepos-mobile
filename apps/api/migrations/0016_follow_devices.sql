-- Multi-device phase 1: «موبايل متابعة» (owner follows the shop from another phone, read-only). Additive only.
-- role: 'main' = the phone that runs the shop (one active), 'follower' = read-only summary viewer.
ALTER TABLE devices ADD COLUMN role TEXT NOT NULL DEFAULT 'main';
CREATE INDEX IF NOT EXISTS devices_business_active ON devices(business_id, deactivated_at, role);

-- Latest summary pushed by the main phone (one row per shop, overwritten; ≤ 48 KB JSON).
CREATE TABLE shop_snapshots (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id),
  device_id TEXT NOT NULL,
  data TEXT NOT NULL,
  size INTEGER NOT NULL,
  received_at INTEGER NOT NULL
);
