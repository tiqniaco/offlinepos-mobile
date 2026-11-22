# Local development

Requirements: Node 22+, pnpm 10 (`corepack enable`), Android Studio (emulator) or a real Android phone.
The app needs a **development build** (native modules: SQLCipher, secure store, biometrics) — Expo Go will not work.

```bash
pnpm install

# 1) Server (Cloudflare Worker) on http://localhost:8787
cd apps/api
cp .dev.vars.example .dev.vars          # dev-only secrets; OTP codes are printed in the terminal
npx wrangler d1 migrations apply daftarak --local
npx wrangler dev

# 2) Super admin on http://localhost:5173
node apps/api/scripts/create-admin.mjs you@example.com 'a-long-password'
#   → run the printed SQL:  npx wrangler d1 execute daftarak --local --command "<SQL>"
#   → add the printed secret to Google Authenticator / Authy
cd apps/admin && cp .env.example .env && pnpm dev

# 3) Mobile app
cd apps/mobile
EXPO_PUBLIC_API_URL=http://10.0.2.2:8787 npx expo run:android   # 10.0.2.2 = your PC from the emulator
```

In development the OTP provider is `console`: the code appears in the `wrangler dev` output.

## Tests
```bash
pnpm -r test                 # everything
cd packages/shared && pnpm test   # money, licence, crypto, TOTP (Vitest)
cd apps/api && pnpm test          # Worker: OTP limits, sessions, licence flow, admin (runs in workerd)
cd apps/mobile && pnpm test       # PIN, audit chain, licence guard, i18n (Jest)
```

## Web preview of onboarding screens
`cd apps/mobile && npx expo start --web` shows the onboarding screens in a browser for design checks
only. Lock, home and more screens: open `/dev-gallery?view=lock|lock-pin|home|home-banner|more`
(sample data, dev builds on web only). There is no database on web; the product is mobile-only.

## Production
- `node apps/api/scripts/gen-licence-key.mjs` → secret to `wrangler secret put LICENCE_SIGNING_KEY --env production`,
  public key into `apps/mobile/src/config/licenceKeys.ts` under kid `2026-01`.
- Other secrets: `ACCESS_TOKEN_SECRET`, `OTP_PEPPER`, `BACKUP_WRAP_KEY`, `SMSMISR_*` (see `.dev.vars.example`).
- Create D1: `npx wrangler d1 create daftarak`, put the id in `wrangler.jsonc`, apply migrations with `--remote`.
- Store release steps are documented in Phase 7.
