import { Pressable, View } from 'react-native';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import colors from './colors.json';

/** Big tappable option card (one-hand friendly) used for country / type / yes-no choices. */
export function Choice({ title, hint, icon, selected, onPress, testID }: { title: string; hint?: string; icon?: IconName; selected: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-[60px] flex-1 flex-row items-center gap-3 rounded-card border-2 px-4 py-3 ${selected ? 'border-teal-500 bg-teal-50' : 'border-paper-line bg-paper-card'}`}
    >
      {icon ? <Icon name={icon} color={selected ? colors.teal[700] : colors.ink.mute} /> : null}
      <View className="flex-1">
        <Text variant="subtitle" className={selected ? 'text-teal-800' : 'text-ink'}>
          {title}
        </Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
      <View className={`h-6 w-6 items-center justify-center rounded-full border-2 ${selected ? 'border-teal-600 bg-teal-600' : 'border-paper-line'}`}>
        {selected ? <Icon name="check" size={14} color="#fff" /> : null}
      </View>
    </Pressable>
  );
}
