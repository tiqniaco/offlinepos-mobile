import { Platform } from 'react-native';
import colors from './colors';

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function build() {
  const dark = colors.isDark;
  return {
    soft: Platform.select({
      web: { boxShadow: dark ? '0 1px 0 rgba(255,255,255,.04), 0 8px 24px rgba(0,0,0,.35)' : `0 1px 2px ${hexA(colors.shadow, 0.05)}, 0 8px 30px ${hexA(colors.shadow, 0.06)}` } as object,
      default: { shadowColor: colors.shadow, shadowOpacity: dark ? 0.35 : 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: dark ? 1 : 3 },
    }) as object,
    lifted: Platform.select({
      web: { boxShadow: `0 2px 4px ${hexA(colors.primary['700'], 0.1)}, 0 14px 32px ${hexA(colors.grad[1], dark ? 0.35 : 0.22)}` } as object,
      default: { shadowColor: colors.grad[1], shadowOpacity: dark ? 0.4 : 0.22, shadowRadius: 22, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
    }) as object,
  };
}

/** Warm/cool soft shadows that follow the theme (two elevations only). */
export const shadow = { ...build(), refresh() { Object.assign(shadow, build()); } };
