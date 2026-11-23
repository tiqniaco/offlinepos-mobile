# رفع السيرفر من GitHub (Cloudflare)

`.github/workflows/deploy-api.yml` deploys the server and the admin panel to Cloudflare. It runs on GitHub, and the Cloudflare token stays in GitHub secrets only. It is safe to run again: it creates what is missing, applies new migrations, and **never replaces** the generated keys.

## 1. Cloudflare token

Cloudflare → My Profile → API Tokens → Create Token → Custom token:

- **Account:** Workers Scripts Edit · D1 Edit · Workers R2 Storage Edit · Cloudflare Pages Edit · Account Settings Read
- **Zone (the Millim domain only):** Zone Read · DNS Edit · Workers Routes Edit

## 2. GitHub → Settings → Secrets and variables → Actions

**Variables**

| Name | Example |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | from the Cloudflare dashboard (right side of the account home) |
| `API_DOMAIN` | `daftarak-api.<millim-domain>` |
| `ADMIN_DOMAIN` | `daftarak-admin.<millim-domain>` (optional) |

**Secrets**

| Name | Notes |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 1 |
| `SMSMISR_USERNAME`, `SMSMISR_PASSWORD`, `SMSMISR_SENDER`, `SMSMISR_TEMPLATE` | login codes by SMS |
| `OTP_TEST_CODE` | **testing only**, instead of SMS Misr: every number logs in with this code. Delete it before real users. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 → Manage API tokens → Object Read & Write on `daftarak-backups` (cloud backups) |
| `ADMIN_PASSWORD` | 12+ characters, for the super-admin |
| `REVENUECAT_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `EXPO_ACCESS_TOKEN` | optional |

## 3. Run

Actions → **deploy-api** → Run workflow. The first time, put your email in `admin_email`.

When it finishes, open the run's **Summary**:

1. Copy the `LICENCE_PUBLIC_KEY` line into a repository **Variable** with that name. The key is public, not secret. The app builds need it.
2. Set the Variable `API_URL` = `https://<API_DOMAIN>` for the app builds.
3. Download the **admin-authenticator** artifact (kept 1 day), add it to Google Authenticator, then delete it.

Then run **build-apps**.
