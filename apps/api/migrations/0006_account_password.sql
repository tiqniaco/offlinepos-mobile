-- Phone + password login (owner). PBKDF2-SHA256; lock-out after repeated failures.
ALTER TABLE accounts ADD COLUMN password_hash TEXT;
ALTER TABLE accounts ADD COLUMN password_salt TEXT;
ALTER TABLE accounts ADD COLUMN password_iters INTEGER;
ALTER TABLE accounts ADD COLUMN password_updated_at INTEGER;
ALTER TABLE accounts ADD COLUMN password_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN password_locked_until INTEGER;
ALTER TABLE sessions ADD COLUMN password_reset_until INTEGER;  -- set by an SMS login; separate from step-up
