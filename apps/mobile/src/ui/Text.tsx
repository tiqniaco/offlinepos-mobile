import { Text as RNText, type TextProps } from 'react-native';
import { fonts } from './fonts';

type Variant = 'display' | 'title' | 'subtitle' | 'body' | 'label' | 'caption' | 'money';

const VARIANTS: Record<Variant, { cls: string; font: keyof typeof fonts }> = {
  display: { cls: 'text-display text-ink', font: 'bold' },
  title: { cls: 'text-title text-ink', font: 'bold' },
  subtitle: { cls: 'text-[17px] leading-[26px] text-ink', font: 'semibold' },
  body: { cls: 'text-body text-ink-soft', font: 'regular' },
  label: { cls: 'text-[14px] leading-[22px] text-ink-soft', font: 'medium' },
  caption: { cls: 'text-tiny text-ink-mute', font: 'regular' },
  money: { cls: 'text-title text-ink', font: 'bold' },
};

/** All text goes through this component: active font (المظهر), RTL-aware alignment, consistent scale. */
export function Text({ variant = 'body', className = '', style, ...rest }: TextProps & { variant?: Variant; className?: string }) {
  const v = VARIANTS[variant];
  return <RNText className={`${v.cls} text-start ${className}`} style={[{ fontFamily: fonts[v.font] }, style]} {...rest} />;
}
