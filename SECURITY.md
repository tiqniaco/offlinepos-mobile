# Security checklist

Honest scope: on a phone the owner controls, a rooted device can be tampered with. We aim for
**tamper-evidence**, encryption at rest, and least privilege — not magic. Details: `PLAN.md §12`.

Legend: ✅ done & tested · 🟡 done, needs on-device verification · ⏳ later phase

## On the phone
- ✅ Local DB encrypted with SQLCipher; 256-bit random key in Keystore/Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`)
- ✅ App refuses to run if the build lacks SQLCipher (no silent plain-text DB)
- 🟡 DB file unreadable without the key (verify on a dev build: pull the file, open with plain sqlite → fails)
- ✅ PIN per user: 4–6 digits, weak PINs rejected, scrypt (N=2^13, r=8) + random salt; never stored in clear
- ✅ PIN lock-out: 5 tries, then 30 s doubling up to 15 min
- ✅ Biometric unlock optional per user (OS prompt; device passcode fallback disabled)
- ✅ Auto-lock after inactivity (default 5 min) and after returning from background
- ✅ Permissions checked in domain services, not only in the UI
- ✅ Audit log append-only (SQLite triggers) and hash-chained; verification screen
- ✅ Licence verified offline with Ed25519; bound to device id; tampered tokens rejected (tests)
- ✅ Clock-rollback guard (max seen time in DB + keystore; > 24 h back ⇒ no new records until online)
- ✅ Android `allowBackup=false` (no Google auto-backup of the DB)
- ✅ Document hash chain (sales, returns, voids, inventory docs) + verification screen; tamper test with triggers removed
- ✅ Posted documents, payments, journal, ledgers immutable / append-only (triggers)
- ✅ Discounts/prices above role limits need a manager PIN, audited
- ✅ Purchases, vouchers and closed shifts immutable + chained; tamper test covers them
- ✅ Daily background chain check with a home-screen alert (owner/manager)
- ✅ Daily server anchors of the chain + audit heads with Ed25519-signed receipts; integrity screen detects rewrites before an anchor
- ✅ Backups encrypted on the phone (AES-256-GCM, per-business key); key released only after a fresh step-up OTP, audit-logged
- ✅ Remote sign-out of lost phones (sessions screen); restore deactivates the old phone
- ✅ Refresh-token rotations serialized (no accidental reuse → no false session revocation) · screenshot block on sensitive screens (Phase 7)
- ⏳ Play Integrity / App Attest (Phase 7)

## Server (Cloudflare Worker)
- ✅ Zod validation on every input; generic error messages
- ✅ OTP: 6 digits, 5 min, 5 attempts, 60 s cooldown, per-phone hour/day caps, per-IP hour cap, HMAC-hashed, EG/SA only
- ✅ Access tokens 15 min (HMAC); refresh tokens rotate, stored hashed, reuse ⇒ session revoked
- ✅ Session list + remote revoke (effective at next check-in)
- ✅ Backup key stored only wrapped (AES-256-GCM with `BACKUP_WRAP_KEY`)
- ✅ Admin: password (PBKDF2-SHA256, 100k — Workers maximum) + TOTP, TOTP replay blocked, lock after 5 failures, 8 h sessions, every action audit-logged
- ✅ Admin API CORS limited to `ADMIN_ORIGIN`; mobile API has no CORS
- ✅ Secrets only in Worker secrets / `.dev.vars` (git-ignored); dev licence key accepted only by debug app builds
- 🟡 Recommended: Cloudflare Access in front of the admin site (Q-12 accepted) — configure at deploy
- ⏳ Rate-limit binding at the edge for abusive IPs (D1 counters are in place now)

## Process
- ✅ CI runs typecheck, all tests and `pnpm audit --prod --audit-level high`; dependency review on PRs
- Before each release: rotate any secret that was ever shared, review this file, run `pnpm audit`.

## Phase 7 review (2026-11)
- ✅ Device integrity: Play Integrity verified server-side (app recognised, device integrity, request hash bound to the
  install, freshness ≤ 10 min); App Attest recorded; policy log/enforce (enforce blocks sign-up & activation only).
- ✅ Optional screenshot / screen-recording block on profit, cost, report and backup screens.
- ✅ E2E-only fixed OTP works only with the console provider (which cannot send SMS) — never in production.
- ✅ No secrets in the app bundle: build-time values are public IDs/keys only (AdMob, RevenueCat public SDK keys,
  GCP project number); all secrets live in Worker secrets / EAS secrets.
- ✅ Dependencies: `pnpm audit` + dependency review in CI; new native deps this phase: expo-notifications,
  @expo/app-integrity, expo-screen-capture, expo-audio, react-native-purchases, react-native-google-mobile-ads.
- Residual risks (unchanged, honest): a rooted phone can still alter data after the last daily anchor; a patched APK can
  bypass the licence check on a rooted phone (integrity verdicts make it visible to us, not impossible).
