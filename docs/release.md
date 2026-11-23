# Release guide

## One-time setup
1. **Cloudflare:** `wrangler d1 create daftarak` (put the id in `apps/api/wrangler.jsonc`), R2 bucket `daftarak-backups`
   (+ S3 API token → `R2_ACCESS_KEY_ID/SECRET`), lifecycle rule "delete after 400 days" as a safety net.
   Secrets: `LICENCE_SIGNING_KEY` (`node apps/api/scripts/gen-licence-key.mjs` → put the PUBLIC key in
   `apps/mobile/src/config/licenceKeys.ts` under the new kid), `ACCESS_TOKEN_SECRET`, `OTP_PEPPER`, `BACKUP_WRAP_KEY`,
   `SMSMISR_*`, `REVENUECAT_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON` (Play Integrity), vars `ANDROID_PACKAGE`,
   `INTEGRITY_MODE=log` (switch to `enforce` after a few weeks of clean verdicts in admin).
   `npx wrangler d1 migrations apply daftarak --remote && npx wrangler deploy --env production`.
   Admin: `node apps/api/scripts/create-admin.mjs`, deploy `apps/admin` to Cloudflare Pages behind Cloudflare Access.
2. **Expo / EAS:** `eas init` → `EAS_PROJECT_ID`; EAS secrets: `EAS_PROJECT_ID`, `ADMOB_*` (app + unit ids),
   `REVENUECAT_ANDROID_KEY`, `REVENUECAT_IOS_KEY`, `GCP_PROJECT_NUMBER`, `SUPPORT_WHATSAPP`. GitHub secret `EXPO_TOKEN`.
3. **Stores:** create the apps (`app.daftarak`), products `daftarak_basic_monthly|yearly`, `daftarak_pro_monthly|yearly`,
   link them in RevenueCat (entitlement per plan), webhook URL `https://api…/v1/webhooks/revenuecat` with the secret.
   Play Console: Data safety (phone number, device id, advertising id, crash data), "contains ads", target audience 18+
   business. App Store: privacy labels (same), ATT text already in the app. Listings: `docs/store/`.

## Every release
1. All CI green (`ci.yml`): typecheck, tests (shared, API, mobile unit + DB), admin build, Android export, audit.
2. Run Maestro (`e2e.yml`, or locally `maestro test apps/mobile/.maestro`) on the release candidate.
3. Tag `vX.Y.Z` → `release.yml` builds signed AAB + IPA on EAS (versionCode/buildNumber auto-increment).
4. `eas submit -p android --profile production` (internal track) → test on 3 phones (mid-range Android, old Android 8,
   iPhone) using `docs/phases/*` 🟡 items → promote to production. Same for iOS via TestFlight.
5. JS-only fixes: `eas update --channel production` (same app version only — runtimeVersion = appVersion).

## Device checks before the first public release (🟡 items)
Real 58/80 mm printers (Arabic, QR, drawer), camera scanning speed (10 items < 20 s), cold start < 2 s on the
reference mid-range Android (`[startup] interactive in … ms` log in a release build via `adb logcat`), backup of a
100k-invoice DB without UI freeze, full restore to a second phone, store purchase → licence within seconds.
