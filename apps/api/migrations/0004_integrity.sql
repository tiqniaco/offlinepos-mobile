-- Phase 7: device integrity verdicts (Play Integrity / App Attest).
ALTER TABLE devices ADD COLUMN integrity_status TEXT;      -- pass | fail | unverified | skipped
ALTER TABLE devices ADD COLUMN integrity_reason TEXT;
ALTER TABLE devices ADD COLUMN integrity_at INTEGER;
