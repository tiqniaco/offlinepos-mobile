import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import colors from './colors.json';

export function ListRow({ icon, title, value, onPress, testID, tone }: { icon?: IconName; title: string; value?: string; onPress?: () => void; testID?: string; tone?: 'danger' }) {
  const c = tone === 'danger' ? colors.rose[500] : colors.teal[600];
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} className="min-h-[56px] flex-row items-center gap-3 px-4 py-3 active:bg-paper-sunk">
      {icon ? <Icon name={icon} color={c} /> : null}
      <Text variant="subtitle" className={`flex-1 ${tone === 'danger' ? 'text-rose-700' : ''}`}>
        {title}
      </Text>
      {value ? <Text variant="caption">{value}</Text> : null}
      {onPress ? <Icon name="chevron" size={18} color={colors.ink.faint} /> : null}
    </Pressable>
  );
}

export function ListGroup({ children }: { children: React.ReactNode }) {
  return <View className="overflow-hidden rounded-card border border-paper-line/60 bg-paper-card">{children}</View>;
}
