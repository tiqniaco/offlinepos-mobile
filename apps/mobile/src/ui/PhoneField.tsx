import { useState } from 'react';
import { fonts } from './fonts';
import { Platform, TextInput, View } from 'react-native';
import { normalizeDigits } from '@daftarak/shared';
import { Text } from './Text';
import { Icon } from './Icon';
import colors from './colors';
import { EGYPT_ONLY } from '../config/market';

/** Mobile number with a country hint chip (EG/SA detected from what is typed). LTR always. */
export function PhoneField({ value, onChangeText, error, onSubmitEditing, testID, placeholder }: { value: string; onChangeText: (v: string) => void; error?: string | null; onSubmitEditing?: () => void; testID?: string; placeholder?: string }) {
  const [focus, setFocus] = useState(false);
  const d = normalizeDigits(value).replace(/\D/g, '');
  const sa = !EGYPT_ONLY && (d.startsWith('05') || d.startsWith('9665') || d.startsWith('5'));
  return (
    <View className="gap-1.5">
      <View
        style={{
          direction: 'ltr',
          flexDirection: 'row',
          alignItems: 'center',
          height: 60,
          borderRadius: 16,
          borderWidth: 2,
          backgroundColor: colors.paper.card,
          borderColor: error ? colors.rose[500] : focus ? colors.primary[500] : colors.paper.line,
          paddingHorizontal: 8,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.paper.sunk, borderRadius: 11, paddingHorizontal: 10, height: 42 }}>
          <Text style={{ fontSize: 20, lineHeight: 26 }}>{sa ? '🇸🇦' : '🇪🇬'}</Text>
          <Text variant="label" style={{ color: colors.ink.DEFAULT }}>
            {sa ? '+966' : '+20'}
          </Text>
        </View>
        <TextInput
          maxFontSizeMultiplier={1.15}
          testID={testID}
          value={value}
          onChangeText={(v) => onChangeText(normalizeDigits(v))}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder={placeholder}
          placeholderTextColor={colors.ink.faint}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          onSubmitEditing={onSubmitEditing}
          autoFocus
          style={[{ flex: 1, minWidth: 0, fontSize: 20, letterSpacing: 1, fontFamily: fonts.semibold, color: colors.ink.DEFAULT, textAlign: 'left', writingDirection: 'ltr', height: '100%' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
        />
        <Icon name="phone" color={colors.ink.faint} size={22} />
      </View>
      {error ? (
        <Text variant="caption" className="text-rose-700">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
