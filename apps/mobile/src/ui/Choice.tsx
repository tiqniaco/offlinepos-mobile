import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { IconBadge, type Hue } from './IconBadge';
import colors from './colors';

/** Big tappable option (one-hand friendly) for country / type / yes-no choices. */
export function Choice({
  title,
  hint,
  icon,
  hue = 'primary',
  emoji,
  selected,
  onPress,
  testID,
  compact = false,
}: {
  title: string;
  hint?: string;
  icon?: IconName;
  hue?: Hue;
  emoji?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  compact?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: compact ? 8 : 12,
        minHeight: compact ? 56 : 72,
        paddingHorizontal: compact ? 12 : 14,
        paddingVertical: 12,
        borderRadius: 18,
        borderWidth: 2,
        borderColor: selected ? colors.primary[500] : colors.paper.line,
        backgroundColor: selected ? colors.primary[50] : colors.paper.card,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon ? <IconBadge name={icon} hue={selected ? 'primary' : hue} size={46} /> : null}
      {emoji ? <Text style={{ fontSize: compact ? 22 : 26, lineHeight: compact ? 30 : 34 }}>{emoji}</Text> : null}
      <View className="flex-1">
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: compact ? 15 : 16, lineHeight: 24, color: selected ? colors.primary[800] : colors.ink.DEFAULT }}>{title}</Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
      <View
        style={{
          width: compact ? 20 : 24,
          height: compact ? 20 : 24,
          borderRadius: 12,
          borderWidth: 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderColor: selected ? colors.primary[600] : colors.paper.line,
          backgroundColor: selected ? colors.primary[600] : 'transparent',
        }}
      >
        {selected ? <Icon name="check" size={14} color="#fff" /> : null}
      </View>
    </Pressable>
  );
}
