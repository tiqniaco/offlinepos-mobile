# Backup, restore, new phone (Phase 6)

Code: codec `packages/shared/src/backupCodec.ts` · device files `apps/mobile/src/features/backup/files.ts` ·
orchestration `features/backup/service.ts` · DB step `domain/backup/restore.ts` · server `apps/api/src/routes/phase6.ts`.

## File format (.obk)
`"OBK1" | u32 headerLen | header JSON | frames`. Header (readable without the key): business, device, schema version,
created, counts. Frames: AES-256-GCM over 256 KB of gzip output, random 96-bit nonce, AAD = SHA-256(header) +
frame index + "last" flag → a changed byte, a swapped header, reordered or missing frames are all rejected. The
payload (DB snapshot + product photos as entries) is checked against its SHA-256 after decryption.

## Creating a backup
1. Snapshot: `ATTACH … KEY ''` + `sqlcipher_export()` — a consistent plain copy in one read transaction.
2. Encrypt in 64 KB slices, yielding to the UI between slices (bench: 100 MB in 11 s on a laptop, slowest 256 KB
   slice 54 ms → 64 KB slices stay far below the 100 ms freeze budget on phones). Plain copy deleted immediately.
3. Upload straight to R2 with a 15-minute presigned PUT (the Worker never sees backup bytes).

**Automatic (daily):** if ≥ 20 h since the last backup and data changed, the file is built before the check-in; the
check-in carries `backupMeta` and returns the PUT URL; the next day's check-in carries `committedBackupId` and the
server verifies the size and commits. Wi-Fi only, or mobile data after 72 h for files < 20 MB. Still **1 Worker
request/day** (+1 R2 PUT) — tested over a 3-day simulated run.
**Manual:** More → النسخ الاحتياطي → "backup now" (upload-url + PUT + commit).
**Offline:** encrypted `.obk` to the share sheet, and an Excel workbook of all data (products & stock, customers,
suppliers, invoices, payments, purchases, vouchers) — allowed even in read-only mode.
**Retention:** plan `backups_kept` (free 3, basic 7, pro 30) applied at each commit; older R2 objects deleted.

## Restore / move to a new phone
OTP login → choose the business → list of cloud backups → **step-up OTP** (fresh code) → download → key released
(audited in `key_releases`) → decrypt + verify → **preview** (business, invoices, products, customers, suppliers, last
invoice) → confirm → `/devices/activate` gives the new device code (old phone becomes read-only at its next check-in)
→ snapshot re-encrypted with this phone's own DB key → `completeRestore` (new device row, own numbering
INV-B-…, own chain from genesis, audit "backup.restore") → lock screen with the restored users.
Restore replaces, never merges.

## Acceptance (tests)
- `domain/backup/restore.db.test.ts`: data → snapshot → encrypt → decrypt → install → **every business table equal**,
  chain of the old device verifies, counts equal, new device sells `INV-B-000001` with a valid chain, books balance.
- `test/backupCodec.test.ts`: round trip with any chunking, compression, wrong key, flipped byte, truncation,
  header tampering, checksum.
- API `test/phase6.test.ts`: upload/commit/list/download/retention, check-in integration, key release needs step-up,
  activation deactivates the old phone, request budget.
🟡 Still to run on real phones: full restore on a second device; UI responsiveness during a 100k-invoice backup.
