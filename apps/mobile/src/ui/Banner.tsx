import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { IconBadge, type Hue } from './IconBadge';
import type { IconName } from './Icon';
import colors from './colors.json';

type Tone = 'info' | 'warn' | 'danger' | 'success';
const TONES: Record<Tone, { bg: string; border: string; color: string; hue: Hue; icon: IconName }> = {
  info: { bg: colors.sky[50], border: '#D3E5F4', color: colors.sky[700], hue: 'sky', icon: 'info' },
  warn: { bg: colors.amber[50], border: colors.amber[100], color: colors.amber[700], hue: 'amber', icon: 'warning' },
  danger: { bg: colors.rose[50], border: '#F4D2CD', color: colors.rose[700], hue: 'rose', icon: 'warning' },
  success: { bg: colors.leaf[50], border: '#CFE8D2', color: colors.leaf[700], hue: 'leaf', icon: 'check' },
};

export function Banner({ tone = 'info', title, text, action, onAction, testID, icon }: { tone?: Tone; title?: string; text: string; action?: string; onAction?: () => void; testID?: string; icon?: IconName }) {
  const t = TONES[tone];
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 18, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border, alignItems: 'center' }}>
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 14 }}>
        <IconBadge name={icon ?? t.icon} hue={t.hue} size={38} />
      </View>
      <View className="flex-1 gap-0.5">
        {title ? <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 15, lineHeight: 22, color: t.color }}>{title}</Text> : null}
        <Text style={{ fontFamily: 'IBMPlexSansArabic_500Medium', fontSize: 13.5, lineHeight: 21, color: t.color }}>{text}</Text>
      </View>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={{ backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 }}>
          <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 13, lineHeight: 20, color: t.color }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
