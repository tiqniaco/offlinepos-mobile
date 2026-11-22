import { ActivityIndicator, Pressable } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import colors from './colors.json';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

const BG: Record<Kind, string> = {
  primary: 'bg-teal-600 active:bg-teal-700',
  secondary: 'bg-paper-card border border-paper-line active:bg-paper-sunk',
  ghost: 'bg-transparent active:bg-paper-sunk',
  danger: 'bg-rose-50 active:bg-rose-500/20',
};
const FG: Record<Kind, string> = { primary: 'text-white', secondary: 'text-teal-700', ghost: 'text-teal-700', danger: 'text-rose-700' };
const ICON_COLOR: Record<Kind, string> = { primary: '#FFFFFF', secondary: colors.teal[700], ghost: colors.teal[700], danger: colors.rose[700] };

export function Button({
  title,
  onPress,
  kind = 'primary',
  loading = false,
  disabled = false,
  icon,
  className = '',
  testID,
}: {
  title: string;
  onPress?: () => void;
  kind?: Kind;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  className?: string;
  testID?: string;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      onPress={off ? undefined : onPress}
      className={`min-h-[52px] flex-row items-center justify-center gap-2 rounded-field px-5 ${BG[kind]} ${off ? 'opacity-50' : ''} ${className}`}
    >
      {loading ? (
        <ActivityIndicator color={ICON_COLOR[kind]} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={ICON_COLOR[kind]} tint="transparent" /> : null}
          <Text variant="subtitle" className={FG[kind]}>
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}
