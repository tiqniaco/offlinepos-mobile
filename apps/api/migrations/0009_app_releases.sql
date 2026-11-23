-- App releases for in-app updates outside the store (Android APK). forced = everyone below this version must update.
CREATE TABLE app_releases (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('android','ios')),
  version_code INTEGER NOT NULL,
  version_name TEXT NOT NULL,
  file_key TEXT,                 -- R2 key under releases/ (android)
  url TEXT,                      -- store / TestFlight link (ios, or android once on Play)
  sha256 TEXT,
  size INTEGER,
  notes_ar TEXT,
  forced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  withdrawn_at INTEGER,
  UNIQUE (platform, version_code)
);
