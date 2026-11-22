import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Text } from './Text';
import { Icon } from './Icon';
import colors from './colors.json';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'bio', '0', 'del'] as const;

/**
 * PIN pad with big keys. Keypad layout stays left-to-right in Arabic too (like the phone dialer).
 * Auto-submits when `length` digits are entered.
 */
export function PinPad({
  value,
  onChange,
  length = 4,
  maxLength = 6,
  onSubmit,
  onBiometric,
  error,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  length?: number;
  maxLength?: number;
  onSubmit?: (v: string) => void;
  onBiometric?: () => void;
  error?: boolean;
  disabled?: boolean;
}) {
  const press = (k: (typeof KEYS)[number]) => {
    if (disabled) return;
    void Haptics.selectionAsync().catch(() => undefined);
    if (k === 'del') return onChange(value.slice(0, -1));
    if (k === 'bio') return onBiometric?.();
    if (value.length >= maxLength) return;
    const next = value + k;
    onChange(next);
    if (next.length === length) onSubmit?.(next);
  };
  return (
    <View className="items-center gap-6">
      <View className="flex-row gap-3" style={{ direction: 'ltr' }} accessibilityLabel={`${value.length} / ${length}`}>
        {Array.from({ length: Math.max(length, value.length) }).map((_, i) => (
          <View
            key={i}
            className={`h-4 w-4 rounded-full border-2 ${error ? 'border-rose-500 bg-rose-500' : i < value.length ? 'border-teal-600 bg-teal-600' : 'border-ink-faint'}`}
          />
        ))}
      </View>
      <View className="w-full max-w-[320px] flex-row flex-wrap justify-between gap-y-3" style={{ direction: 'ltr' }}>
        {KEYS.map((k) =>
          k === 'bio' && !onBiometric ? (
            <View key={k} className="h-[68px] w-[30%]" />
          ) : (
            <Pressable
              key={k}
              testID={`pin-${k}`}
              accessibilityRole="button"
              accessibilityLabel={k}
              onPress={() => press(k)}
              className="h-[68px] w-[30%] items-center justify-center rounded-2xl bg-paper-card active:bg-teal-50"
            >
              {k === 'del' ? (
                <Icon name="back" color={colors.ink.soft} />
              ) : k === 'bio' ? (
                <Icon name="fingerprint" color={colors.teal[600]} />
              ) : (
                <Text className="font-semibold text-[26px] leading-[34px] text-ink">{k}</Text>
              )}
            </Pressable>
          ),
        )}
      </View>
    </View>
  );
}
