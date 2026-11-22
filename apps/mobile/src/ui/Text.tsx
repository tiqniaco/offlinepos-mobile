import { Text as RNText, type TextProps } from 'react-native';

type Variant = 'display' | 'title' | 'subtitle' | 'body' | 'label' | 'caption' | 'money';

const VARIANTS: Record<Variant, string> = {
  display: 'font-bold text-display text-ink',
  title: 'font-bold text-title text-ink',
  subtitle: 'font-semibold text-[17px] leading-[26px] text-ink',
  body: 'font-sans text-body text-ink-soft',
  label: 'font-medium text-[14px] leading-[22px] text-ink-soft',
  caption: 'font-sans text-tiny text-ink-mute',
  money: 'font-bold text-title text-ink',
};

/** All text goes through this component: correct font, RTL-aware alignment, consistent scale. */
export function Text({ variant = 'body', className = '', ...rest }: TextProps & { variant?: Variant; className?: string }) {
  return <RNText className={`${VARIANTS[variant]} text-start ${className}`} {...rest} />;
}
