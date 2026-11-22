import { View } from 'react-native';
import { Text } from './Text';
import { IconBadge, type Hue } from './IconBadge';
import type { IconName } from './Icon';
import colors from './colors';

export function EmptyState({ icon, hue = 'primary', title, body, children }: { icon: IconName; hue?: Hue; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 36, paddingHorizontal: 12 }}>
      <View style={{ padding: 14, borderRadius: 32, backgroundColor: colors.paper.card }}>
        <IconBadge name={icon} hue={hue} size={72} />
      </View>
      <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 19, lineHeight: 28, color: colors.ink.DEFAULT, textAlign: 'center' }}>{title}</Text>
      {body ? (
        <Text variant="body" style={{ textAlign: 'center', maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {children ? <View style={{ width: '100%', gap: 10, marginTop: 8 }}>{children}</View> : null}
    </View>
  );
}
