import { create } from 'zustand';
import colors from './colors';
import { shadow } from './shadow';
import { buildTheme, cssVars, type Appearance, type PaletteId } from './theme';

interface ThemeState {
  palette: PaletteId;
  appearance: Appearance;
  /** Increments on every change; the root layout uses it as a key to repaint everything. */
  version: number;
  vars: Record<string, string>;
  isDark: boolean;
  /** Screen to reopen after the repaint (the tree remounts on theme change). */
  returnTo: string | null;
}

export const useTheme = create<ThemeState>(() => ({
  palette: 'tiqnia',
  appearance: 'light',
  version: 0,
  vars: cssVars(colors),
  isDark: false,
  returnTo: null,
}));

function assignDeep(target: Record<string, unknown>, src: Record<string, unknown>) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') assignDeep(target[k] as Record<string, unknown>, v as Record<string, unknown>);
    else target[k] = v;
  }
}

/** Apply palette + appearance. `systemDark` resolves the 'system' appearance. */
export function applyTheme(palette: PaletteId, appearance: Appearance, systemDark: boolean) {
  const mode = appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance;
  const t = buildTheme(palette, mode);
  assignDeep(colors as unknown as Record<string, unknown>, t as unknown as Record<string, unknown>);
  shadow.refresh();
  const s = useTheme.getState();
  if (s.palette === palette && s.appearance === appearance && s.isDark === t.isDark && s.version > 0 && JSON.stringify(s.vars) === JSON.stringify(cssVars(t))) return;
  useTheme.setState({ palette, appearance, isDark: t.isDark, vars: cssVars(t), version: s.version + 1 });
}
