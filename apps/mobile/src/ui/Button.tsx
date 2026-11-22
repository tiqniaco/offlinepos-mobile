import { ActivityIndicator, Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { shadow } from './shadow';
import colors from './colors.json';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';

const FG: Record<Kind, string> = { primary: '#FFFFFF', secondary: colors.teal[700], ghost: colors.teal[700], danger: colors.rose[700], light: colors.teal[800] };

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading = false,
  disabled = false,
  icon,
  className = '',
  testID,
  compact = false,
}: {
  title: string;
  onPress?: () => void;
  kind?: Kind;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  className?: string;
  testID?: string;
  compact?: boolean;
}) {
  const off = disabled || loading;
  const h = compact ? 44 : 56;
  const content = loading ? (
    <ActivityIndicator color={FG[kind]} />
  ) : (
    <View className="flex-row items-center justify-center gap-2">
      <Text style={{ color: FG[kind], fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: compact ? 15 : 17, lineHeight: compact ? 22 : 26 }}>{title}</Text>
      {icon ? <Icon name={icon} size={compact ? 18 : 20} color={FG[kind]} tint="transparent" /> : null}
    </View>
  );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={off ? undefined : onPress}
      className={`${className}`}
      style={({ pressed }) => [
        { borderRadius: 16, opacity: off ? 0.45 : 1, transform: [{ scale: pressed && !off ? 0.985 : 1 }] },
        kind === 'primary' && !off ? shadow.lifted : null,
      ]}
    >
      {kind === 'primary' ? (
        <LinearGradient
          colors={[colors.teal[500], colors.teal[600], colors.teal[700]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ height: h, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={{
            height: h,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: compact ? 14 : 20,
            backgroundColor: kind === 'secondary' ? colors.paper.card : kind === 'danger' ? colors.rose[50] : kind === 'light' ? '#FFFFFF' : 'transparent',
            borderWidth: kind === 'secondary' ? 1.5 : 0,
            borderColor: colors.teal[100],
          }}
        >
          {content}
        </View>
      )}
    </Pressable>
  );
}
