import { Pressable, View } from 'react-native';
import { fonts } from './fonts';
import { Text } from './Text';
import colors from './colors';

export function Chip({ label, selected, onPress, count, dot, testID }: { label: string; selected?: boolean; onPress?: () => void; count?: number; dot?: string | null; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 34,
        paddingHorizontal: 12,
        borderRadius: 17,
        borderWidth: 1.5,
        borderColor: selected ? colors.primary[600] : colors.paper.line,
        backgroundColor: selected ? colors.primary[600] : colors.paper.card,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {dot ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} /> : null}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 20, color: selected ? '#FFFFFF' : colors.ink.soft }}>{label}</Text>
      {count != null ? (
        <View style={{ minWidth: 22, height: 20, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? 'rgba(255,255,255,0.25)' : colors.paper.sunk }}>
          <Text style={{ fontSize: 12, lineHeight: 18, fontFamily: fonts.bold, color: selected ? '#FFFFFF' : colors.ink.soft }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
