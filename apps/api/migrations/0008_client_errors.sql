-- Crash reports from the app (render errors that would otherwise show a blank screen). No personal data.
CREATE TABLE client_errors (
  id TEXT PRIMARY KEY,
  where_ TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  app_version TEXT,
  platform TEXT,
  ip TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX client_errors_at ON client_errors(at);
