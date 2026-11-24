import { ActivityIndicator, View } from 'react-native';
import { PressableScale } from './PressableScale';
import { fonts } from './fonts';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { shadow } from './shadow';
import colors from './colors';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger' | 'light';


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
  const FG: Record<Kind, string> = { primary: '#FFFFFF', secondary: colors.primary[700], ghost: colors.primary[700], danger: '#FFFFFF', light: colors.grad[1] };
  const off = disabled || loading;
  const h = compact ? 40 : 50;
  const content = loading ? (
    <ActivityIndicator color={FG[kind]} />
  ) : (
    <View className="flex-row items-center justify-center gap-2">
      <Text style={{ color: FG[kind], fontFamily: fonts.bold, fontSize: compact ? 15 : 16.5, lineHeight: compact ? 22 : 24 }}>{title}</Text>
      {icon ? <Icon name={icon} size={compact ? 16 : 18} color={FG[kind]} tint="transparent" /> : null}
    </View>
  );
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={off ? undefined : onPress}
      feedback={off ? undefined : 'tap'}
      scaleTo={0.975}
      className={`${className}`}
      style={[{ borderRadius: 14, opacity: off ? 0.45 : 1 }, (kind === 'primary' || kind === 'danger') && !off ? shadow.lifted : null]}
    >
      {kind === 'primary' || kind === 'danger' ? (
        <LinearGradient
          // Danger (delete, sign out a phone…): a red gradient like a phone's "end call" button.
          colors={kind === 'danger' ? [colors.rose[500], colors.rose[700]] : colors.grad}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ height: h, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 }}
        >
          {content}
        </LinearGradient>
      ) : (
        <View
          style={{
            height: h,
            borderRadius: 14,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: compact ? 14 : 20,
            backgroundColor: kind === 'secondary' ? colors.paper.card : kind === 'light' ? '#FFFFFF' : 'transparent',
            borderWidth: kind === 'secondary' ? 1.5 : 0,
            borderColor: colors.primary[100],
          }}
        >
          {content}
        </View>
      )}
    </PressableScale>
  );
}
