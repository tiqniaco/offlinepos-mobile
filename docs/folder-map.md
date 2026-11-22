# Folder map — what is where, what links to what

```
apps/mobile/
  app.config.ts            app name, icons, native plugins (SQLCipher ON), API url from env
  src/app/                 ROUTES (Expo Router). File = screen.
    _layout.tsx            fonts, boot(), auto-lock, route guards by app status
    (auth)/                onboarding: index (welcome) → phone → otp → choose-business | business → owner
    lock.tsx               user tiles + PIN pad + biometrics
    (main)/                tabs: index (home), more
    settings/              users, user-form, security, language, subscription, audit
    (main)/products.tsx    products tab;  products/  form, [id], adjust, count, categories, bulk, import, check
    scan.tsx               full-screen camera scanner (vision-camera + ML Kit)
    fatal.tsx              shown if the DB can't be opened encrypted
    dev-gallery.tsx        DEV + web only: renders the pure views with sample data for design review
  src/features/            pure views (props in, no DB) + bigger shared UI:
    lock/LockView.tsx  home/HomeView.tsx  more/MoreView.tsx  LicenceBanner.tsx
    inventory/             ProductsListView, ProductRow, ProductDetailView, ProductsMenu, excel.ts (SheetJS),
                           images.ts (photo compress/save), useInvCtx, errors
                           screens in src/app are thin containers that load data and render these
  src/state/app.ts         Zustand: app status, current user, licence, settings (UI mirror only)
  src/state/boot.ts        start-up sequence + background check-in
  src/domain/
    auth/pin.ts            PIN rules, scrypt hashing, lock-out policy (pure, tested)
    auth/users.ts          roles seed, users CRUD, unlock with PIN/biometric, permissions
    audit/audit.ts         append + verify the hash-chained audit log
    licence/guard.ts       assertCanWrite / assertWithinLimit (used by every write)
    licence/service.ts     store licence, clock guard (max seen time), daily check-in
    settings/settings.ts   typed settings read/write with audit
    onboarding.ts          create business / attach device, then one local transaction
    inventory/             context, seed (units, warehouse), ledger (post/check/rebuild), products,
                           adjust (adjustments + counts), catalog (categories, units), import, search (FTS),
                           numbering; inventory.db.test.ts = SQLite integration tests
    device.ts              current device id/code (kv_meta)
  src/db/schema.ts         Drizzle tables  →  `pnpm db:generate`  →  src/db/migrations/*
  src/db/client.ts         opens SQLCipher with the keystore key, runs migrations
  src/db/tx.ts             withTx(): the ONLY way to run a write transaction (see ledger.md)
  src/db/types.ts          driver-agnostic Db type used by domain code
  src/lib/secure.ts        keystore secrets: DB key, backup key, refresh token, install id
  src/api/client.ts        typed Worker client (Zod-validated responses)
  src/config/licenceKeys.ts  Ed25519 PUBLIC keys for offline licence verification
  src/i18n/ar.json en.json Arabic (default) and English copy — same keys (tested)
  src/ui/                  design system; colors.json feeds Tailwind and code
                           Hero (gradient header), OnboardingScreen/Screen, Card, Button, TextField,
                           PhoneField, OtpInput, PinPad/PinDots, Choice, ListRow/ListGroup, IconBadge,
                           Avatar, Steps, Banner, Logo, Icon (custom duotone set), shadow

apps/api/
  wrangler.jsonc           bindings, vars, production env
  migrations/              D1 schema + seed plans (applied by wrangler)
  src/index.ts             Hono app: /health, /v1/*, /admin/*
  src/routes/v1.ts         mobile API (OTP, sessions, businesses, devices, check-in)
  src/admin/routes.ts      super-admin API (login+TOTP, businesses, plans, settings, audit)
  src/otp/                 OTP rules + providers (SMS Misr, console)
  src/auth/tokens.ts       access tokens, rotating refresh tokens, revoke
  src/licence/issue.ts     builds & signs licences and anchor receipts
  scripts/                 create-admin, gen-licence-key
  test/                    Worker tests (run inside workerd via @cloudflare/vitest-plugin)

apps/admin/src/            App.tsx (all screens), api.ts (client), styles.css

packages/shared/src/
  money.ts                 divRound (THE rounding function), allocate, VAT split, parse/format
  text.ts                  Arabic→Latin digits, Arabic search normalisation
  phone.ts                 EG/SA mobile validation → E.164
  ids.ts                   UUIDv7, Hybrid Logical Clock
  crypto.ts                canonical JSON, SHA-256 chain hash, base64url, Ed25519
  licence.ts               licence payload schema, sign/verify, computeLicenceState
  plans.ts permissions.ts profiles.ts api.ts totp.ts
```

Links: `apps/*` import `@daftarak/shared` (TypeScript source, no build step).
