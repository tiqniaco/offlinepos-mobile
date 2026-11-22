import { Pressable, View } from 'react-native';
import { Text, IconBadge, colors, fonts, shadow, type IconName, type Hue } from '../../ui';

/** A compact document row used by vouchers / purchases / shifts lists. */
export function DocRow({ icon, hue, title, subtitle, amount, amountColor, tag, tagColor, voided, onPress }: { icon: IconName; hue: Hue; title: string; subtitle?: string; amount: string; amountColor?: string; tag?: string; tagColor?: string; voided?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
      <IconBadge name={icon} hue={voided ? 'ink' : hue} size={36} />
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: voided ? colors.ink.faint : colors.ink.DEFAULT, textDecorationLine: voided ? 'line-through' : 'none' }}>{title}</Text>
        {subtitle ? <Text variant="caption" numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, color: voided ? colors.ink.faint : (amountColor ?? colors.ink.DEFAULT) }}>{amount}</Text>
        {tag ? <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, color: tagColor ?? colors.ink.mute }}>{tag}</Text> : null}
      </View>
    </Pressable>
  );
}
