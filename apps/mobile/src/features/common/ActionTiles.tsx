import { Pressable, View } from 'react-native';
import { Text, IconBadge, colors, fonts, shadow, type IconName, type Hue } from '../../ui';

export interface Tile {
  key: string;
  icon: IconName;
  hue: Hue;
  label: string;
  onPress: () => void;
  testID?: string;
}

/** Grid of compact action tiles (home quick actions, party actions, export bar). */
export function ActionTiles({ tiles, columns = 4, flat = false }: { tiles: Tile[]; columns?: number; flat?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {tiles.map((x) => (
        <Pressable
          key={x.key}
          testID={x.testID ?? `tile-${x.key}`}
          accessibilityRole="button"
          onPress={x.onPress}
          style={({ pressed }) => [
            { width: `${100 / columns - 2.2}%`, flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, backgroundColor: colors.paper.card, opacity: pressed ? 0.8 : 1 },
            flat ? { borderWidth: 1, borderColor: colors.paper.line } : shadow.soft,
          ]}
        >
          <IconBadge name={x.icon} hue={x.hue} size={34} />
          <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 19, color: colors.ink.soft, textAlign: 'center' }}>
            {x.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
