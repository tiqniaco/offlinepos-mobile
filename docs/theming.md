# Theming — palettes and light / dark / comfort

Code: `apps/mobile/src/ui/theme.ts` (palettes + modes), `colors.ts` (live tokens), `themeStore.ts`
(`applyTheme`, `useTheme`), `shadow.ts`, `tailwind.config.js` (CSS variables).
Settings → المزيد → **المظهر**. Saved per device in `settings` (`palette`, `appearance`), allowed even read-only.

## Palettes
| id | name | primary 500 / 600 | neutrals |
|---|---|---|---|
| `tiqnia` (default) | تقنية | `#0866FF` / `#0F4CC7` (TIQNIA Brand Guidelines V1.0), navy `#0B1F4D` | cool: `#F8F9FC` bg, `#101828` text |
| `teal` | تركواز | `#18A999` / `#0E8C80` (original Daftarak look) | warm paper |
| `emerald` | زمردي | `#16A34A` / `#15803D` | cool |
| `sunset` | برتقالي | `#F26419` / `#D9480F` | warm |
| `graphite` | جرافيت | `#475569` / `#334155` | cool |

No purple anywhere (tested: no token hue between 260° and 320°).

## Appearance
- **فاتح (light)** – palette neutrals.
- **داكن (dark)** – navy-black surfaces; tinted backgrounds (50–200) are mixed from the brand colour; 700–900
  (used for text on tints) become light so text stays readable.
- **مريح للعين (comfort)** – warm paper, softer contrast, brand colours shifted warm (less blue light).
- **تلقائي (system)** – follows the phone's light/dark setting live.

Every palette × mode is tested for contrast (body text ≥ 7:1 on background, secondary text ≥ 4.5:1,
white on primary button ≥ 3:1) in `src/ui/theme.test.ts`.

## Rules for code
- Use tokens only: `colors.primary[600]`, `colors.paper.card`, `colors.grad`… or classes `bg-primary-600`,
  `text-ink-soft`. Never hard-code a hex for anything that should follow the theme
  (white text on gradients is fine).
- Read `colors` **at render time**. Don't copy colours into module-level constants — build them inside the
  component (or a function) so they follow the theme.
- `primary` = brand scale (buttons, links, selection). `accent` = decorative (logo tick, glows).
  `amber/rose/leaf/sky` = semantic (warning/error/success/info).
- How it repaints: `applyTheme()` rewrites the shared `colors` object, regenerates the CSS variables and bumps
  a version; the root layout uses that version as a `key`, so every screen remounts with the new colours and
  the appearance screen is reopened.

## Fonts
`src/ui/fonts.ts` — live `fonts` object (`regular/medium/semibold/bold`), chosen in المظهر, saved as setting `font`.
| id | font | note |
|---|---|---|
| `readex` (default) | Readex Pro | clearest digits and prices at small sizes; modern |
| `alexandria` | Alexandria | geometric, a bit heavier |
| `almarai` | Almarai | popular in KSA (no 500/600 weights → mapped) |
| `plex` | IBM Plex Sans Arabic | the TIQNIA brand-guidelines font |
Only the chosen family is loaded at start. Use `fonts.bold` etc. (or `<Text variant>`), never a font file name.
