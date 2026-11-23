import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { fonts, type, LINE, MAX_FONT_MULTIPLIER } from './fonts';

type Variant = 'display' | 'title' | 'subtitle' | 'body' | 'label' | 'caption' | 'money';

/** Compact, calm type scale (sizes at text size "medium"; المظهر → حجم الخط scales everything). */
const VARIANTS: Record<Variant, { cls: string; font: keyof typeof fonts; size: number; line: number }> = {
  display: { cls: 'text-ink', font: 'bold', size: 20, line: 30 },
  title: { cls: 'text-ink', font: 'bold', size: 15.5, line: 24 },
  subtitle: { cls: 'text-ink', font: 'semibold', size: 13.5, line: 21 },
  body: { cls: 'text-ink-soft', font: 'regular', size: 13, line: 20 },
  label: { cls: 'text-ink-soft', font: 'medium', size: 12, line: 18 },
  caption: { cls: 'text-ink-mute', font: 'regular', size: 11, line: 16 },
  money: { cls: 'text-ink', font: 'bold', size: 16, line: 24 },
};

/**
 * All text goes through this component: active font, RTL-aware alignment, one consistent scale.
 * Explicit `fontSize`/`lineHeight` in `style` are scaled by `type.legacy × type.scale`, so older screens
 * follow the same compact scale and the user's text-size choice.
 */
export function Text({ variant = 'body', className = '', style, ...rest }: TextProps & { variant?: Variant; className?: string }) {
  const v = VARIANTS[variant];
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const k = type.scale * type.legacy;
  const sized: { -readonly [K in keyof TextStyle]: TextStyle[K] } = {
    fontFamily: fonts[v.font],
    fontSize: v.size * type.scale,
    lineHeight: v.line * type.scale,
    ...flat,
  };
  if (flat.fontSize) sized.fontSize = flat.fontSize * k;
  if (flat.lineHeight) sized.lineHeight = flat.lineHeight * k;
  // Never let the line be shorter than the Arabic glyphs (clipped text on device).
  sized.lineHeight = Math.max(Number(sized.lineHeight ?? 0), Number(sized.fontSize ?? 14) * LINE);
  return <RNText maxFontSizeMultiplier={MAX_FONT_MULTIPLIER} className={`${v.cls} text-start ${className}`} style={sized} {...rest} />;
}

/** Scale a raw size for components that render TextInput etc. directly. */
export function fs(n: number): number {
  return n * type.scale * type.legacy;
}
