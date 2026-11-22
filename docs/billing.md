# Subscriptions & activation codes (Phase 6)

- **Store (RevenueCat):** `react-native-purchases`, `appUserID` = server business id (the subscription follows the
  business to a new phone). Products are named like `daftarak_basic_monthly`, `daftarak_pro_yearly` (plan + period
  parsed from the id). Keys: `REVENUECAT_ANDROID_KEY`, `REVENUECAT_IOS_KEY` at build time; without keys the store
  section is hidden.
- **Webhook:** `POST /v1/webhooks/revenuecat`, header `Authorization: Bearer <REVENUECAT_WEBHOOK_SECRET>`; idempotent by
  event id (`billing_events`). Purchase / renewal / product change → plan until the store expiry (`plan_source =
  store`); billing issue → `past_due`; cancellation/expiration need nothing (the licence falls to grace, then the free
  plan — never read-only for that, D-20).
- **Activation codes:** admin → أكواد التفعيل → generate a batch (plan, days, count, note) → CSV for the sales rep.
  Owner: الاشتراك → "عندك كود تفعيل؟". One use, revocable; renewing the same plan extends from the current expiry.
- **After any change** the app runs a check-in to fetch the new signed licence (paid plan hides ads at once).
- **Free plan limits:** only new records above a limit are blocked, with an upgrade sheet; nothing is deleted.
- **Admin dashboard:** total, active (30 days), trials, paid by plan, MRR (EGP/SAR, yearly ÷ 12), 30-day churn,
  requests per business per day (avg / max of the last 7 days).
