import { useState } from 'react';
import { Platform, TextInput, View, type TextInputProps } from 'react-native';
import { normalizeDigits } from '@daftarak/shared';
import { Text } from './Text';
import { Icon, type IconName } from './Icon';
import colors from './colors.json';

export interface TextFieldProps extends Omit<TextInputProps, 'onChangeText'> {
  label?: string;
  error?: string | null;
  hint?: string;
  icon?: IconName;
  onChangeText?: (v: string) => void;
  /** Convert Arabic/Persian digits to Latin as the user types (D-21). Default true. */
  latinDigits?: boolean;
  /** Force left-to-right input (phone numbers, codes, tax numbers). */
  ltr?: boolean;
}

export function TextField({ label, error, hint, icon, onChangeText, latinDigits = true, ltr = false, className, style, ...rest }: TextFieldProps) {
  const [focus, setFocus] = useState(false);
  return (
    <View className={`gap-1.5 ${className ?? ''}`}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 56,
          borderRadius: 16,
          borderWidth: 2,
          paddingHorizontal: 14,
          gap: 10,
          backgroundColor: colors.paper.card,
          borderColor: error ? colors.rose[500] : focus ? colors.teal[500] : colors.paper.line,
        }}
      >
        {icon ? <Icon name={icon} size={22} color={focus ? colors.teal[600] : colors.ink.faint} /> : null}
        <TextInput
          placeholderTextColor={colors.ink.faint}
          onFocus={(e) => {
            setFocus(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocus(false);
            rest.onBlur?.(e);
          }}
          style={[
            { flex: 1, minWidth: 0, height: '100%', fontSize: 17, fontFamily: 'IBMPlexSansArabic_500Medium', color: colors.ink.DEFAULT, textAlign: ltr ? 'left' : 'auto' },
            ltr ? { writingDirection: 'ltr' } : null,
            Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null,
            style,
          ]}
          onChangeText={(v) => onChangeText?.(latinDigits ? normalizeDigits(v) : v)}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="caption" className="text-rose-700">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="caption">{hint}</Text>
      ) : null}
    </View>
  );
}
