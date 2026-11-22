# Ads (AdMob) — free plan only

Code: `apps/mobile/src/features/ads/` · rules: PLAN.md §18 · owner decision D-20.

- `policy.ts` (unit-tested): banners only in `home, products, parties, reports, expenses, settings, purchases`;
  never POS, payment, receipt/printing, returns, lock, onboarding, forms. Interstitial ≤ 1 per 15 min, never in the
  first 2 min, only after a finished non-sale task (PDF/Excel export).
- Shown only when the licence has `showAds` (no `no_ads` feature **and** server `ads_enabled` = kill switch) **and**
  the phone is online (`expo-network`). Offline → nothing rendered, nothing blocks work.
- `backend.native.ts`: Google UMP consent (`AdsConsent.gatherConsent`) → `mobileAds().initialize()` → preloaded
  interstitial; non-personalised ads unless the user agreed. `backend.ts` / `AdBanner.tsx` = no-op on web/tests.
- IDs: app IDs in `app.config.ts` (env `ADMOB_ANDROID_APP_ID`, `ADMOB_IOS_APP_ID`), unit IDs in `extra.admob`
  (env `ADMOB_BANNER_*`, `ADMOB_INTERSTITIAL_*`). Empty / dev builds → Google **test** IDs.
- Store forms (Phase 7): Play "contains ads" + Data safety (advertising ID); App Store privacy labels; iOS ATT text set.
