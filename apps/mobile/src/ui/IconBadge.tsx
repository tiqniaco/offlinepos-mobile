import { View } from 'react-native';
import { Icon, type IconName } from './Icon';
import colors from './colors';

export type Hue = 'primary' | 'amber' | 'sky' | 'rose' | 'leaf' | 'ink';
function hues(): Record<Hue, { bg: string; fg: string }> {
  return {
  primary: { bg: colors.primary[50], fg: colors.primary[600] },
  amber: { bg: colors.amber[50], fg: colors.amber[600] },
  sky: { bg: colors.sky[50], fg: colors.sky[500] },
  rose: { bg: colors.rose[50], fg: colors.rose[500] },
  leaf: { bg: colors.leaf[50], fg: colors.leaf[500] },
  ink: { bg: colors.paper.sunk, fg: colors.ink.soft },
  };
}

/** Coloured duotone icon in a soft rounded square — the app's signature for lists and options. */
export function IconBadge({ name, hue = 'primary', size = 44, glass = false }: { name: IconName; hue?: Hue; size?: number; glass?: boolean }) {
  const h = hues()[hue];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: glass ? 'rgba(255,255,255,0.16)' : h.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={name} size={size * 0.55} color={glass ? '#FFFFFF' : h.fg} tint={glass ? 'rgba(255,255,255,0.18)' : undefined} />
    </View>
  );
}
