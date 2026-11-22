# How to add a module (e.g. "expenses")

1. **Schema** — add tables to `apps/mobile/src/db/schema.ts` following the conventions in
   `data-model.md` → `pnpm db:generate`. Append-only tables get triggers in a custom migration.
2. **Shared logic** — anything pure (calculations, validation schemas) goes in `packages/shared/src`
   with Vitest tests. Money: only `divRound` / `allocate` from `money.ts`.
3. **Domain service** — `apps/mobile/src/domain/<module>/…`:
   - first lines: `requirePermission(user, '<perm>')`, `assertCanWrite()` (or `assertWithinLimit`)
   - one `db.transaction` per user action; call `appendAudit(tx, …)` for sensitive changes
   - no React imports.
4. **Screens** — routes in `src/app/…`, components from `src/ui`. All text via `t('…')` in
   both `ar.json` and `en.json` (the parity test fails otherwise). Use logical classes (`ps-`, `pe-`,
   `text-start`) so RTL works. Adding things lives in the list's + button, not in menus.
5. **Permissions** — new permission keys go in `packages/shared/src/permissions.ts` and the system roles.
6. **Docs** — update `folder-map.md`, `data-model.md` and the phase checklist in the same commit.
