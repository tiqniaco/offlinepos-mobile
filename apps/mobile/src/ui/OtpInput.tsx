import { useRef, useState, type ComponentRef } from 'react';
import { fonts } from './fonts';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { digitsOnly } from '@daftarak/shared';
import { Text } from './Text';
import colors from './colors';

/**
 * Six separate boxes over one hidden input (keeps SMS autofill and paste working).
 * Always left-to-right, like the code in the SMS.
 */
export function OtpInput({ value, onChange, length = 6, error, testID }: { value: string; onChange: (v: string) => void; length?: number; error?: boolean; testID?: string }) {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(true);
  return (
    <Pressable onPress={() => ref.current?.focus()} style={{ direction: 'ltr' }}>
      <View className="flex-row justify-between gap-2" style={{ direction: 'ltr' }}>
        {Array.from({ length }).map((_, i) => {
          const ch = value[i] ?? '';
          const active = focused && i === Math.min(value.length, length - 1);
          return (
            <View
              key={i}
              style={{
                flex: 1,
                maxWidth: 54,
                height: 62,
                borderRadius: 14,
                borderWidth: 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: ch ? colors.primary[50] : colors.paper.card,
                borderColor: error ? colors.rose[500] : active ? colors.primary[500] : ch ? colors.primary[200] : colors.paper.line,
              }}
            >
              <Text style={{ fontSize: 26, lineHeight: 34, fontFamily: fonts.bold, color: colors.ink.DEFAULT }}>{ch}</Text>
            </View>
          );
        })}
      </View>
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        onChangeText={(v) => onChange(digitsOnly(v).slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={length}
        autoFocus
        caretHidden
        style={[{ position: 'absolute', opacity: 0.01, width: '100%', height: '100%' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
      />
    </Pressable>
  );
}
