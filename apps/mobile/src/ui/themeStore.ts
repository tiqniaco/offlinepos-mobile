import { create } from 'zustand';
import colors from './colors';
import { shadow } from './shadow';
import { buildTheme, cssVars, type Appearance, type PaletteId } from './theme';
import { applyTextSize, currentFont, loadFontFamily, type as typeState, type FontId, type TextSize } from './fonts';

interface ThemeState {
  palette: PaletteId;
  appearance: Appearance;
  font: FontId;
  textSize: TextSize;
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
  font: 'readex',
  textSize: 'md',
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

/** Switch font family (loads its files first), then repaint like a theme change. */
export async function applyFont(id: FontId): Promise<void> {
  await loadFontFamily(id);
  const s = useTheme.getState();
  if (s.font === currentFont && s.version > 0) return;
  useTheme.setState({ font: currentFont, version: s.version + 1 });
}

/** Change text size (صغير / متوسط / كبير) and repaint. */
export function setTextSize(size: TextSize) {
  applyTextSize(size);
  const s = useTheme.getState();
  if (s.textSize === typeState.size && s.version > 0) return;
  useTheme.setState({ textSize: typeState.size, version: s.version + 1 });
}
