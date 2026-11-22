import { Pressable, View } from 'react-native';
import { Text, colors, fonts } from '../../ui';
import { haptic } from '../../ui/haptics';

/** Two-to-four option switch (عملاء | موردين, مفصل | مختصر…). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.paper.sunk, borderRadius: 12, padding: 3, gap: 3 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} testID={`seg-${o.value}`} onPress={() => { if (!on) haptic.select(); onChange(o.value); }} style={{ flex: 1, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.paper.card : 'transparent' }}>
            <Text style={{ fontFamily: on ? fonts.bold : fonts.medium, fontSize: 14.5, lineHeight: 20, color: on ? colors.primary[700] : colors.ink.mute }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
