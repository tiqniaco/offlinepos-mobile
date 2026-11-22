import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizePhone } from '@daftarak/shared';
import { Screen, Text, Button, TextField } from '../../ui';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useOnboarding } from '../../state/app';
import i18n from '../../i18n';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(useOnboarding.getState().phone);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const phone = normalizePhone(raw);
    if (!phone) return setError(t('phone.invalid'));
    setError(null);
    setBusy(true);
    try {
      await api.requestOtp(phone, i18n.language === 'en' ? 'en' : 'ar');
      useOnboarding.getState().set({ phone });
      router.push('/otp');
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('phone.title')} footer={<Button testID="phone-send" title={t('phone.send')} loading={busy} onPress={submit} />}>
      <Text>{t('phone.body')}</Text>
      <TextField
        testID="phone-input"
        label={t('phone.label')}
        placeholder={t('phone.placeholder')}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        ltr
        value={raw}
        onChangeText={setRaw}
        error={error}
        onSubmitEditing={submit}
        autoFocus
      />
    </Screen>
  );
}
