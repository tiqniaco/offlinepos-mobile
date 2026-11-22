import { View } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import { Button } from './Button';
import colors from './colors.json';

type Tone = 'info' | 'warn' | 'danger' | 'success';
const TONES: Record<Tone, { bg: string; color: string; icon: IconName }> = {
  info: { bg: 'bg-sky-50', color: colors.sky[700], icon: 'info' },
  warn: { bg: 'bg-amber-50', color: colors.amber[700], icon: 'warning' },
  danger: { bg: 'bg-rose-50', color: colors.rose[700], icon: 'warning' },
  success: { bg: 'bg-leaf-50', color: colors.leaf[700], icon: 'check' },
};

export function Banner({ tone = 'info', text, action, onAction, testID }: { tone?: Tone; text: string; action?: string; onAction?: () => void; testID?: string }) {
  const t = TONES[tone];
  return (
    <View testID={testID} className={`flex-row items-center gap-3 rounded-card px-4 py-3 ${t.bg}`}>
      <Icon name={t.icon} color={t.color} />
      <Text variant="label" className="flex-1" style={{ color: t.color }}>
        {text}
      </Text>
      {action && onAction ? <Button kind="ghost" title={action} onPress={onAction} className="min-h-[40px] px-2" /> : null}
    </View>
  );
}
