import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { digitsOnly, OTP_POLICY } from '@daftarak/shared';
import { Screen, Text, Button, TextField } from '../../ui';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useOnboarding } from '../../state/app';
import { deviceInfo } from '../../domain/onboarding';
import i18n from '../../i18n';

export default function OtpScreen() {
  const { t } = useTranslation();
  const phone = useOnboarding((s) => s.phone);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(OTP_POLICY.resendCooldownMs / 1000);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await api.verifyOtp(phone, value, await deviceInfo());
      useOnboarding.getState().set({ auth });
      router.replace(auth.businesses.length > 0 ? '/choose-business' : '/business');
    } catch (e) {
      setError(errorMessage(t, e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.requestOtp(phone, i18n.language === 'en' ? 'en' : 'ar');
      setWait(OTP_POLICY.resendCooldownMs / 1000);
      setError(null);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  };

  return (
    <Screen back title={t('otp.title')} footer={<Button testID="otp-verify" title={t('otp.verify')} loading={busy} disabled={code.length !== 6} onPress={() => verify()} />}>
      <Text>{t('otp.body', { phone: `+${phone}` })}</Text>
      <TextField
        testID="otp-input"
        label={t('otp.title')}
        value={code}
        onChangeText={(v) => {
          const d = digitsOnly(v).slice(0, 6);
          setCode(d);
          if (d.length === 6) void verify(d);
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        maxLength={6}
        ltr
        autoFocus
        error={error}
        style={{ fontSize: 28, letterSpacing: 10, textAlign: 'center' }}
      />
      <View className="items-center">
        {wait > 0 ? <Text variant="caption">{t('otp.resendIn', { s: wait })}</Text> : <Button kind="ghost" title={t('otp.resend')} onPress={resend} />}
        <Button kind="ghost" title={t('otp.changePhone')} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
