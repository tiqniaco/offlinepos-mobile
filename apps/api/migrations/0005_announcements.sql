-- Super-admin announcements: push (Expo) + in-app inbox delivered with the daily check-in.
ALTER TABLE devices ADD COLUMN push_token TEXT;
ALTER TABLE devices ADD COLUMN announcements_until INTEGER NOT NULL DEFAULT 0;   -- created_at of the last delivered announcement

CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title_ar TEXT NOT NULL,
  body_ar TEXT NOT NULL,
  title_en TEXT,
  body_en TEXT,
  url TEXT,                               -- in-app screen to open (allow-listed)
  target_json TEXT NOT NULL,              -- {all} | {countries} | {plans} | {statuses} | {businessIds}
  push INTEGER NOT NULL DEFAULT 1,
  push_sent INTEGER NOT NULL DEFAULT 0,
  push_failed INTEGER NOT NULL DEFAULT 0,
  delivered INTEGER NOT NULL DEFAULT 0,   -- devices that received it in-app (check-in)
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
CREATE INDEX announcements_created ON announcements(created_at);
