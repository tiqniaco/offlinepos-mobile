/**
 * Theme system: a colour PALETTE (brand hue) × an APPEARANCE (light / dark / comfort / system).
 *
 * - `colors` (./colors.ts) is one mutable object that every component reads at render time.
 *   `applyTheme()` rewrites it in place and also produces CSS variables for NativeWind classes
 *   (tailwind.config.js maps `bg-primary-600`, `text-ink` … to `rgb(var(--c-…))`).
 * - The root layout remounts the screen tree when the theme changes, so everything repaints at once.
 * - Default palette = TIQNIA brand blues (Brand Guidelines V1.0 · 2026). No purple, ever.
 */
export type ScaleKey = '50' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
export type Scale = Record<ScaleKey, string>;
type SmallScale = Record<'50' | '100' | '300' | '500' | '600' | '700', string>;

export interface ThemeColors {
  paper: { DEFAULT: string; card: string; sunk: string; line: string };
  ink: { DEFAULT: string; soft: string; mute: string; faint: string };
  /** Brand scale (buttons, links, selection). */
  primary: Scale;
  /** Decorative accent from the palette (logo tick, hero glow, badges on gradients). */
  accent: { DEFAULT: string; onDark: string; soft: string };
  /** Hero / primary-button gradient, start → end. */
  grad: [string, string, string];
  amber: SmallScale;
  rose: SmallScale;
  leaf: SmallScale;
  sky: SmallScale;
  inverse: { bg: string; text: string };
  shadow: string;
  isDark: boolean;
}

export type PaletteId = 'tiqnia' | 'teal' | 'emerald' | 'sunset' | 'graphite';
export type Appearance = 'light' | 'dark' | 'comfort' | 'system';

interface Palette {
  id: PaletteId;
  nameAr: string;
  nameEn: string;
  primary: Scale;
  accent: string;
  accentOnDark: string;
  neutrals: 'cool' | 'warm';
}

export const PALETTES: Palette[] = [
  {
    // TIQNIA: Deep Blue #0F4CC7 (main), Electric Blue #0866FF, Sky Blue #0080F9, Navy #0B1F4D, accent-on-dark #6FA0FF.
    id: 'tiqnia',
    nameAr: 'تقنية',
    nameEn: 'TIQNIA',
    primary: { '50': '#EEF3FF', '100': '#DCE6FF', '200': '#B9CCFF', '300': '#8EADFF', '400': '#6FA0FF', '500': '#0866FF', '600': '#0F4CC7', '700': '#0D3FA6', '800': '#0B2F78', '900': '#0B1F4D' },
    accent: '#0080F9',
    accentOnDark: '#6FA0FF',
    neutrals: 'cool',
  },
  {
    id: 'teal',
    nameAr: 'تركواز',
    nameEn: 'Teal',
    primary: { '50': '#E7F6F3', '100': '#C9ECE6', '200': '#97D9CF', '300': '#5FC2B4', '400': '#2FAE9E', '500': '#18A999', '600': '#0E8C80', '700': '#0B6B63', '800': '#08524C', '900': '#063D39' },
    accent: '#F2A93B',
    accentOnDark: '#FFD58A',
    neutrals: 'warm',
  },
  {
    id: 'emerald',
    nameAr: 'زمردي',
    nameEn: 'Emerald',
    primary: { '50': '#E8F7EE', '100': '#CDEEDB', '200': '#9EDCB8', '300': '#67C590', '400': '#36AD6C', '500': '#16A34A', '600': '#15803D', '700': '#166534', '800': '#14532D', '900': '#0F3D22' },
    accent: '#EAB308',
    accentOnDark: '#FDE68A',
    neutrals: 'cool',
  },
  {
    id: 'sunset',
    nameAr: 'برتقالي',
    nameEn: 'Sunset',
    primary: { '50': '#FFF2EA', '100': '#FFE0CC', '200': '#FFC09A', '300': '#FF9A61', '400': '#FB7A36', '500': '#F26419', '600': '#D9480F', '700': '#B23A0E', '800': '#862C0C', '900': '#5C1F0A' },
    accent: '#0EA5A4',
    accentOnDark: '#7FE0DE',
    neutrals: 'warm',
  },
  {
    id: 'graphite',
    nameAr: 'جرافيت',
    nameEn: 'Graphite',
    primary: { '50': '#F1F4F8', '100': '#E2E8F0', '200': '#CBD5E1', '300': '#94A3B8', '400': '#64748B', '500': '#475569', '600': '#334155', '700': '#1E293B', '800': '#162032', '900': '#0F172A' },
    accent: '#38BDF8',
    accentOnDark: '#93D9FB',
    neutrals: 'cool',
  },
];

const SEMANTIC = {
  amber: { '50': '#FEF5E6', '100': '#FCE6BF', '300': '#F7C66F', '500': '#F2A93B', '600': '#D98E1F', '700': '#B17016' },
  rose: { '50': '#FCEDEA', '100': '#F7D5CF', '300': '#E98B83', '500': '#D9534A', '600': '#C0413A', '700': '#A8352E' },
  leaf: { '50': '#EAF6EA', '100': '#CDEACF', '300': '#8DCB94', '500': '#3F9D4B', '600': '#348A40', '700': '#2C7536' },
  sky: { '50': '#E8F2FA', '100': '#CFE3F4', '300': '#8CBDE6', '500': '#3B82C4', '600': '#306FAA', '700': '#28609A' },
};

const NEUTRALS = {
  cool: { paper: { DEFAULT: '#F8F9FC', card: '#FFFFFF', sunk: '#F2F4F7', line: '#EAECF0' }, ink: { DEFAULT: '#101828', soft: '#475467', mute: '#667085', faint: '#98A2B3' } },
  warm: { paper: { DEFAULT: '#F6F2EA', card: '#FFFDF8', sunk: '#EFE8DA', line: '#E4DAC6' }, ink: { DEFAULT: '#1F2A2E', soft: '#4A5A60', mute: '#7C8A8F', faint: '#A9B3B6' } },
  dark: { paper: { DEFAULT: '#0B1220', card: '#141D2E', sunk: '#1B2538', line: '#26324A' }, ink: { DEFAULT: '#F2F4F7', soft: '#C3CBD8', mute: '#8F9AAD', faint: '#5F6B80' } },
  // "Comfort" (مريح للعين): warm paper, softer contrast, less blue light.
  comfort: { paper: { DEFAULT: '#F3EAD8', card: '#FAF3E6', sunk: '#EADFC9', line: '#DCCDB0' }, ink: { DEFAULT: '#3A3124', soft: '#5C5141', mute: '#857963', faint: '#AEA38C' } },
};

// ── colour math ──
function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** t = weight of `a` (1 → a, 0 → b). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 * t + r2 * (1 - t), g1 * t + g2 * (1 - t), b1 * t + b2 * (1 - t));
}
export function rgbTriplet(h: string): string {
  return hexToRgb(h).join(' ');
}

function darkScale(s: Scale, card: string): Scale {
  return {
    '50': mix(s['500'], card, 0.16),
    '100': mix(s['500'], card, 0.26),
    '200': mix(s['500'], card, 0.42),
    '300': s['300'],
    '400': s['400'],
    '500': s['500'],
    '600': s['600'],
    // 700–900 are used for TEXT on tinted backgrounds → must be light in dark mode.
    '700': s['300'],
    '800': s['200'],
    '900': s['100'],
  };
}
function darkSmall(s: SmallScale, card: string): SmallScale {
  return { '50': mix(s['500'], card, 0.16), '100': mix(s['500'], card, 0.28), '300': s['300'], '500': mix(s['500'], '#FFFFFF', 0.85), '600': s['300'], '700': s['300'] };
}
function warmScale(s: Scale): Scale {
  const out = {} as Scale;
  (Object.keys(s) as ScaleKey[]).forEach((k) => (out[k] = mix(s[k], '#8A6A3F', 0.7)));
  return out;
}

export function buildTheme(paletteId: PaletteId, mode: Exclude<Appearance, 'system'>): ThemeColors {
  // Always a fresh deep copy: the live `colors` object is mutated in place by applyTheme and must
  // never share references with the palette constants.
  return JSON.parse(JSON.stringify(buildThemeShared(paletteId, mode))) as ThemeColors;
}

function buildThemeShared(paletteId: PaletteId, mode: Exclude<Appearance, 'system'>): ThemeColors {
  const p = PALETTES.find((x) => x.id === paletteId) ?? PALETTES[0]!;
  if (mode === 'dark') {
    const n = NEUTRALS.dark;
    return {
      ...n,
      primary: darkScale(p.primary, n.paper.card),
      accent: { DEFAULT: p.accentOnDark, onDark: p.accentOnDark, soft: mix(p.accent, n.paper.card, 0.2) },
      grad: [p.primary['600'], p.primary['700'], p.primary['900']],
      amber: darkSmall(SEMANTIC.amber, n.paper.card),
      rose: darkSmall(SEMANTIC.rose, n.paper.card),
      leaf: darkSmall(SEMANTIC.leaf, n.paper.card),
      sky: darkSmall(SEMANTIC.sky, n.paper.card),
      inverse: { bg: '#E9EDF3', text: '#101828' },
      shadow: '#000000',
      isDark: true,
    };
  }
  if (mode === 'comfort') {
    const n = NEUTRALS.comfort;
    const primary = warmScale(p.primary);
    return {
      ...n,
      primary,
      accent: { DEFAULT: mix(p.accent, '#8A6A3F', 0.8), onDark: p.accentOnDark, soft: mix(p.accent, n.paper.card, 0.18) },
      grad: [primary['500'], primary['600'], primary['800']],
      amber: SEMANTIC.amber,
      rose: SEMANTIC.rose,
      leaf: SEMANTIC.leaf,
      sky: SEMANTIC.sky,
      inverse: { bg: '#3A3124', text: '#FAF3E6' },
      shadow: '#5A4526',
      isDark: false,
    };
  }
  const n = NEUTRALS[p.neutrals];
  return {
    ...n,
    primary: p.primary,
    accent: { DEFAULT: p.accent, onDark: p.accentOnDark, soft: mix(p.accent, n.paper.card, 0.14) },
    // TIQNIA gradient rule: blue family only (#0866FF → #0F4CC7 → navy).
    grad: [p.primary['500'], p.primary['600'], p.primary['800']],
    amber: SEMANTIC.amber,
    rose: SEMANTIC.rose,
    leaf: SEMANTIC.leaf,
    sky: SEMANTIC.sky,
    inverse: { bg: n.ink.DEFAULT, text: '#FFFFFF' },
    shadow: p.neutrals === 'cool' ? '#101828' : '#3A2E1A',
    isDark: false,
  };
}

/** CSS variable map for NativeWind (names must match tailwind.config.js). */
export function cssVars(t: ThemeColors): Record<string, string> {
  const v: Record<string, string> = {};
  const add = (name: string, hex: string) => (v[`--c-${name}`] = rgbTriplet(hex));
  add('paper', t.paper.DEFAULT);
  add('paper-card', t.paper.card);
  add('paper-sunk', t.paper.sunk);
  add('paper-line', t.paper.line);
  add('ink', t.ink.DEFAULT);
  add('ink-soft', t.ink.soft);
  add('ink-mute', t.ink.mute);
  add('ink-faint', t.ink.faint);
  add('accent', t.accent.DEFAULT);
  (Object.keys(t.primary) as ScaleKey[]).forEach((k) => add(`primary-${k}`, t.primary[k]));
  for (const hue of ['amber', 'rose', 'leaf', 'sky'] as const) {
    for (const [k, val] of Object.entries(t[hue])) add(`${hue}-${k}`, val);
  }
  return v;
}
