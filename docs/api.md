# Worker API reference

Base URL: your Worker domain. JSON in/out. Errors: `{ "error": { "code", "message", "retryAfterMs?" } }`
with codes from `API_ERROR_CODES` (`packages/shared/src/api.ts`). All bodies are validated with Zod.

## Mobile (`/v1`) — no CORS (the app is not a browser)
| Method & path | Auth | Body → Response |
|---|---|---|
| `POST /v1/auth/otp/request` | — | `{phone, locale?}` → `{phone (E.164), resendAfterMs, expiresInMs}` |
| `POST /v1/auth/otp/verify` | — | `{phone, code, device}` → `{accessToken, refreshToken, accessExpiresAt, account, businesses[]}` |
| `POST /v1/auth/refresh` | — | `{refreshToken}` → new pair (old refresh token reused ⇒ session revoked) |
| `POST /v1/auth/logout` | Bearer | → `{ok}` |
| `POST /v1/auth/step-up/request` / `verify` | Bearer | fresh OTP for sensitive actions (used from Phase 6) |
| `GET /v1/sessions` | Bearer | → list of active sessions (`current` flag) |
| `DELETE /v1/sessions/:id` | Bearer | remote revoke (effective at that phone's next check-in) |
| `POST /v1/businesses` | Bearer | `{name, country, type, vatRegistered, backupKey, device}` → `{business, registration{businessId, deviceId, deviceCode, licence, serverTime}}` |
| `POST /v1/devices/attach` | Bearer | `{businessId, device}` → same as above; previous phone deactivated |
| `POST /v1/checkin` | refresh token in body | `{refreshToken, deviceId, appVersion, deviceTime, anchor?}` → `{licence, serverTime, refreshToken, accessToken, accessExpiresAt, anchorReceipt, notices[]}` |
| `GET /health` | — | `{ok:true}` |

`device` = `{installId, platform: android|ios, model?, appVersion}`.
Tokens: access 15 min (HMAC); refresh 90 days, rotating, only SHA-256 stored.

## Admin (`/admin`) — CORS only for `ADMIN_ORIGIN`
`POST /login {email, password, totp}` → `{token, expiresAt}` (8 h). Then `Authorization: Bearer <token>`.
`POST /logout`, `GET /me`, `GET /businesses?q=&page=`, `GET /businesses/:id` (devices + requests/day),
`POST /businesses/:id/extend-trial {days}`, `POST /businesses/:id/plan {planCode, expiresAt, status}`,
`POST /businesses/:id/suspend {suspended}`, `GET /plans`, `PUT /plans/:code {...}`,
`GET /settings`, `PUT /settings/ads {enabled}`, `GET /audit`. Every mutation is written to `admin_audit`.

## Request budget
`request_counters` counts requests per business per UTC day (business creation, attach, check-in).
Normal day: **1 check-in** (+1 direct R2 upload from Phase 6). Visible per business in super admin.

## Phase 6 endpoints
| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/checkin` (+ `backupMeta`, `committedBackupId`, `anchor`) | refresh | returns `backupPut` (presigned PUT), `backupCommitted`, `anchorReceipt` |
| `POST /v1/backups/upload-url` | access | manual backup: pending row + presigned PUT (15 min) |
| `POST /v1/backups/:id/commit` | access | verify object size in R2, commit, apply plan retention |
| `GET /v1/backups?businessId=` | access (owner) | committed backups for restore |
| `POST /v1/backups/:id/download-url` | access (owner) | presigned GET + sha256 + size |
| `POST /v1/backups/key` | access + step-up ≤ 10 min | releases the backup key (audited in `key_releases`) |
| `POST /v1/devices/activate` | access + step-up | restore on a new phone: new device code, old one deactivated |
| `POST /v1/licence/activation-code` | access (owner) | redeem a code → plan/expiry |
| `POST /v1/webhooks/revenuecat` | shared secret | store events → plan (idempotent) |
| `POST /admin/codes`, `GET /admin/codes`, `POST /admin/codes/:code/revoke` | admin | activation codes |
| `GET /admin/metrics` | admin | total, active30, trials, paid by plan, MRR, churn30, requests/business/day |
Errors added: `step_up_required`, `code_invalid`, `code_used`, `backup_not_uploaded`.
New Worker config: R2 binding `BACKUPS`, vars `R2_ACCOUNT_ID`, `R2_BUCKET`; secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `REVENUECAT_WEBHOOK_SECRET`.
