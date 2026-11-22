import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { IconBadge, type Hue } from './IconBadge';
import { shadow } from './shadow';
import colors from './colors';

export function ListRow({
  icon,
  hue = 'primary',
  title,
  subtitle,
  value,
  onPress,
  testID,
  tone,
  last = false,
  leading,
}: {
  icon?: IconName;
  hue?: Hue;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  testID?: string;
  tone?: 'danger';
  last?: boolean;
  leading?: React.ReactNode;
}) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? colors.paper.sunk : 'transparent' })}>
      <View className="min-h-[64px] flex-row items-center gap-3 px-4 py-3">
        {leading ?? (icon ? <IconBadge name={icon} hue={tone === 'danger' ? 'rose' : hue} size={40} /> : null)}
        <View className="flex-1">
          <Text style={{ fontFamily: 'IBMPlexSansArabic_600SemiBold', fontSize: 16, lineHeight: 24, color: tone === 'danger' ? colors.rose[700] : colors.ink.DEFAULT }}>{title}</Text>
          {subtitle ? <Text variant="caption">{subtitle}</Text> : null}
        </View>
        {value ? (
          <View className="rounded-full bg-paper-sunk px-3 py-1">
            <Text variant="caption" style={{ color: colors.ink.soft }}>
              {value}
            </Text>
          </View>
        ) : null}
        {onPress ? <Icon name="chevron" size={18} color={colors.ink.faint} /> : null}
      </View>
      {!last ? <View style={{ height: 1, backgroundColor: colors.paper.line, opacity: 0.6, marginStart: 68 }} /> : null}
    </Pressable>
  );
}

export function ListGroup({ children }: { children: React.ReactNode }) {
  return (
    <View style={[{ borderRadius: 20, backgroundColor: colors.paper.card, overflow: 'hidden' }, shadow.soft]}>
      {children}
    </View>
  );
}
