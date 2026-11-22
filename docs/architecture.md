# Architecture

See `PLAN.md §1` for the diagram. In one paragraph:

The **phone is the system**. Every business record lives in an encrypted SQLite database on the
phone (SQLCipher). The app never needs the internet for daily work. A tiny Cloudflare Worker does
only: phone sign-up (OTP), issuing **signed licences**, one **daily check-in** (licence refresh +
integrity anchor + token rotation), backups (Phase 6) and the super-admin API. It never receives
business data.

## The three rules (from SPEC.md)
1. The phone is the system — offline first, always.
2. Near-zero server load — ≤ 5 requests per business per day (we use ~2).
3. Simple, fast, beautiful — Arabic first, one-hand use, ≤ 3 taps for common actions.

## Layers inside the app
```
src/app/*        Expo Router screens (thin: layout + calls)
src/features/*   bigger UI pieces shared by screens
src/ui/*         design system (tokens, Text, Button, TextField, Card, PinPad, Icon…)
src/domain/*     business logic, NO React: users, licence guard, audit, settings, onboarding
src/db/*         schema (Drizzle), migrations, encrypted connection
packages/shared  pure logic shared with the server (money, licence, crypto, schemas)
```
Rule: screens never write SQL; they call `src/domain`. Domain services check
**permissions** (`requirePermission`) and the **licence guard** (`assertCanWrite`) themselves,
so hiding a button is never the only protection.

## Start-up sequence (`src/state/boot.ts`)
1. Read the DB key from the OS keystore → open SQLCipher (refuse to run if SQLCipher is missing).
2. Run pending migrations.
3. Load settings → language → layout direction (RTL for Arabic).
4. Evaluate the stored licence **offline** (Ed25519 signature) → mode.
5. Show the lock screen. Check-in runs in the background if due (> 20 h).

## Versions in use
Expo SDK 58, React Native 0.88, React 19.3, Expo Router 58, NativeWind 4 (Tailwind 3),
Drizzle ORM 0.45, Hono 4, Wrangler 4, Vitest 5, Jest 30, TypeScript 6.
