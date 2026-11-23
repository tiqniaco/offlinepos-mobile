-- Manual payments (InstaPay / Vodafone Cash): the owner sends a receipt photo, a super admin activates within the SLA.
CREATE TABLE payment_requests (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  plan_code TEXT NOT NULL REFERENCES plans(code),
  period TEXT NOT NULL CHECK (period IN ('monthly','yearly')),
  amount_minor INTEGER NOT NULL,                 -- computed server-side from the plan price
  currency TEXT NOT NULL DEFAULT 'EGP',
  method TEXT NOT NULL CHECK (method IN ('instapay','vodafone_cash')),
  payer_phone TEXT NOT NULL,                     -- local Egyptian format 01xxxxxxxxx
  note TEXT,
  receipt_key TEXT NOT NULL,                     -- R2 (BACKUPS) key: receipts/<businessId>/<id>.<ext>
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reject_reason TEXT,
  reviewed_by TEXT,                              -- admin_users.id
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX payment_requests_status ON payment_requests(status, created_at);
CREATE INDEX payment_requests_business ON payment_requests(business_id, created_at);

-- Payment numbers + activation SLA (editable in super admin → Settings).
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('pay_instapay', '01558858884'),
  ('pay_vodafone_cash', '01017686542'),
  ('pay_sla_hours', '12');
