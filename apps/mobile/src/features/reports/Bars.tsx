import { View } from 'react-native';
import { Text, colors } from '../../ui';

/** Simple 30-day bar chart (no chart library; Views only). Today highlighted. */
export function Bars({ values, labels }: { values: number[]; labels?: [string, string] }) {
  const max = Math.max(1, ...values);
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 2 }}>
        {values.map((v, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(2, (Math.max(0, v) / max) * 90), borderRadius: 3, backgroundColor: i === values.length - 1 ? colors.primary[600] : colors.primary[200] }} />
        ))}
      </View>
      {labels ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
          <Text variant="caption">{labels[0]}</Text>
          <Text variant="caption">{labels[1]}</Text>
        </View>
      ) : null}
    </View>
  );
}
