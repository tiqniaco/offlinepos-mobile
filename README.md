# دفترك — Daftarak

Arabic-first, offline-first mobile POS & inventory for shops in Egypt and Saudi Arabia.
The phone is the system; the server only handles sign-up, licences, backups and super-admin.

- Product spec: [`SPEC.md`](SPEC.md) · Architecture plan & decisions: [`PLAN.md`](PLAN.md)
- Developer docs: [`docs/`](docs/README.md) · Security checklist: [`SECURITY.md`](SECURITY.md)

| Folder | What it is |
|---|---|
| `apps/mobile` | Expo (React Native) app — Android first, iOS second |
| `apps/api` | Cloudflare Worker (Hono + D1): OTP, licences, check-in, admin API |
| `apps/admin` | Super-admin web app (React + Vite, Cloudflare Pages) |
| `packages/shared` | Pure TypeScript shared by all: money, licence, crypto, schemas, profiles |

Quick start: see [`docs/dev-setup.md`](docs/dev-setup.md).
