import { TextInput, View, type TextInputProps } from 'react-native';
import { normalizeDigits } from '@daftarak/shared';
import { Text } from './Text';
import colors from './colors.json';

export interface TextFieldProps extends Omit<TextInputProps, 'onChangeText'> {
  label: string;
  error?: string | null;
  hint?: string;
  onChangeText?: (v: string) => void;
  /** Convert Arabic/Persian digits to Latin as the user types (D-21). Default true. */
  latinDigits?: boolean;
  /** Force left-to-right input (phone numbers, codes, tax numbers). */
  ltr?: boolean;
}

export function TextField({ label, error, hint, onChangeText, latinDigits = true, ltr = false, className, ...rest }: TextFieldProps) {
  return (
    <View className={`gap-1.5 ${className ?? ''}`}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.ink.faint}
        className={`min-h-[52px] rounded-field border bg-paper-card px-4 font-sans text-[17px] text-ink ${
          error ? 'border-rose-500' : 'border-paper-line focus:border-teal-500'
        } ${ltr ? 'text-left' : 'text-start'}`}
        style={ltr ? { writingDirection: 'ltr' } : undefined}
        onChangeText={(v) => onChangeText?.(latinDigits ? normalizeDigits(v) : v)}
        {...rest}
      />
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
