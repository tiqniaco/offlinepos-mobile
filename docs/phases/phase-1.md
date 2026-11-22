# Phase 1 — Foundation: acceptance checklist

Legend: ✅ done and verified here · 🟡 built, but needs verification on a real phone / emulator
(this work was done in a cloud container without an Android emulator) · ❌ not done

| # | Criterion (PLAN.md §15) | Status | Evidence |
|---|---|---|---|
| 1 | Fresh install → OTP → onboarding → home in < 60 s | 🟡 | Flow implemented end-to-end; server side of the same flow verified locally against `wrangler dev` (OTP → business → check-in). Timing must be measured on a dev build. |
| 2 | After first login, airplane mode: open, unlock, navigate, change settings — no network | 🟡 | No screen or domain call needs the network after onboarding; check-in failure is silent (`runCheckin` → `offline`). Needs a Maestro/airplane run on device. |
| 3 | Licence verified offline (valid, tampered, wrong key, wrong device, expired, grace, `refresh_by`, clock rollback) | ✅ | `packages/shared/test/licence.test.ts` (17 cases), `apps/mobile/src/domain/licence/guard.test.ts` |
| 4 | Expired licence → read-only enforced in the domain guard and visible in UI | ✅ / 🟡 | Guard tests ✅ (`assertCanWrite`); banner component `LicenceBanner` — visual check on device 🟡. Owner decision D-20: trial/plan end ⇒ **free plan**, read-only only for 30 days offline / suspended / deactivated / clock rollback. |
| 5 | OTP tests: 6 digits, 5-min expiry, 5 attempts, 60 s cooldown, per-phone & per-IP limits, hashed storage | ✅ | `apps/api/test/otp.test.ts` (10 tests) |
| 6 | Admin login requires TOTP; extend trial reflects in the app after next check-in | ✅ | `apps/api/test/admin.test.ts`; also verified in a browser against `wrangler dev` (screenshot `docs/screenshots/phase1-admin-business.png`) |
| 7 | DB file not readable without the key | 🟡 | `db/client.ts` requires SQLCipher (`PRAGMA cipher_version`) and keys with a 256-bit keystore key. Pull-the-file test needs a dev build. |
| 8 | Docs: architecture, folder map, data model & migrations, licence flow, API reference, how to add a module, dev setup; SECURITY.md v1 | ✅ | `docs/`, `SECURITY.md` |

## Test totals at the end of Phase 1
- `packages/shared`: 56 tests (Vitest) — money/rounding, digits, phone, canonical JSON, hashing, UUIDv7, HLC, TOTP vectors, licence
- `apps/api`: 26 tests (Vitest inside workerd) — OTP rules, sessions & refresh reuse, licence flow, device attach, admin
- `apps/mobile`: 19 tests (Jest) — PIN rules & hashing & lock-out, audit chain tamper detection, licence guard, i18n parity & Latin digits
- Android JS bundle builds (`expo export --platform android`), admin builds (`vite build`).

## What you need to do to close the 🟡 items
1. `cd apps/mobile && npx expo run:android` on an emulator or phone (see `docs/dev-setup.md`).
2. Go through onboarding with a stopwatch; then enable airplane mode and use the app.
3. Optional: pull `daftarak.db` with `adb` and try opening it with `sqlite3` — it must fail.
