import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TextField } from './TextField';
import { Text } from './Text';
import colors from './colors';

/** Password input with a show/hide toggle (Arabic digits are normalised like everywhere else). */
export function PasswordField(props: { label: string; value: string; onChangeText: (v: string) => void; error?: string | null; testID?: string; onSubmitEditing?: () => void; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <View className="gap-1">
      <TextField
        testID={props.testID}
        icon="lock"
        label={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="password"
        textContentType="password"
        ltr
        error={props.error ?? undefined}
        onSubmitEditing={props.onSubmitEditing}
        autoFocus={props.autoFocus}
      />
      <Pressable onPress={() => setShow((s) => !s)} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
        <Text style={{ fontSize: 12, lineHeight: 18, color: colors.primary[600] }}>{show ? t('login.hide') : t('login.show')}</Text>
      </Pressable>
    </View>
  );
}
