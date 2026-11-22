import { Pressable, View } from 'react-native';
import { fonts } from './fonts';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { Icon } from './Icon';
import { shadow } from './shadow';
import colors from './colors';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'] as const;

export function PinDots({ count, total, error, light = false }: { count: number; total: number; error?: boolean; light?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 14, direction: 'ltr' }} accessibilityLabel={`${count} / ${total}`}>
      {Array.from({ length: total }).map((_, i) => {
        const on = i < count;
        const base = light ? 'rgba(255,255,255,' : 'rgba(31,42,46,';
        return (
          <View
            key={i}
            style={{
              width: on ? 16 : 14,
              height: on ? 16 : 14,
              borderRadius: 8,
              backgroundColor: error ? colors.rose[500] : on ? (light ? '#FFFFFF' : colors.primary[600]) : 'transparent',
              borderWidth: on || error ? 0 : 2,
              borderColor: base + '0.35)',
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * Round-key PIN pad. Layout stays left-to-right in Arabic too, like the phone dialer.
 * PINs are 4–6 digits, so the caller decides when to submit.
 */
export function PinPad({ value, onChange, maxLength = 6, onBiometric, disabled }: { value: string; onChange: (v: string) => void; maxLength?: number; onBiometric?: () => void; disabled?: boolean }) {
  const press = (k: (typeof KEYS)[number]) => {
    if (disabled) return;
    void Haptics.selectionAsync().catch(() => undefined);
    if (k === 'del') return onChange(value.slice(0, -1));
    if (k === 'bio') return onBiometric?.();
    if (value.length >= maxLength) return;
    onChange(value + k);
  };
  return (
    <View style={{ width: '100%', maxWidth: 300, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 14, direction: 'ltr' }}>
      {KEYS.map((k) => {
        if (k === 'bio' && !onBiometric) return <View key={k} style={{ width: 76, height: 76 }} />;
        const plain = k === 'bio' || k === 'del';
        return (
          <Pressable
            key={k}
            testID={`pin-${k}`}
            accessibilityRole="button"
            accessibilityLabel={k}
            onPress={() => press(k)}
            style={({ pressed }) => [
              { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
              plain ? null : { backgroundColor: pressed ? colors.primary[50] : colors.paper.card, ...(shadow.soft as object) },
              plain && pressed ? { backgroundColor: colors.paper.sunk } : null,
            ]}
          >
            {k === 'del' ? (
              <Icon name="backspace" color={colors.ink.soft} size={28} />
            ) : k === 'bio' ? (
              <Icon name="fingerprint" color={colors.primary[600]} size={30} />
            ) : (
              <Text style={{ fontFamily: fonts.semibold, fontSize: 28, lineHeight: 36, color: colors.ink.DEFAULT }}>{k}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}
