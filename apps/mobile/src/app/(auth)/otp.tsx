import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OTP_POLICY } from '@daftarak/shared';
import { OnboardingScreen, Text, Button, OtpInput, Card, colors } from '../../ui';
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
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await api.verifyOtp(phone, value, await deviceInfo());
      useOnboarding.getState().set({ auth });
      // The SMS code proved the phone: choose the account password (new account or forgot password).
      router.replace('/password');
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
    <OnboardingScreen
      step={2}
      stepLabel={t('onboarding.step', { n: 2, total: 4 })}
      title={t('otp.title')}
      subtitle={t('otp.body', { phone: `+${phone}` })}
      footer={<Button testID="otp-verify" title={t('otp.verify')} loading={busy} disabled={code.length !== 6} onPress={() => verify()} />}
    >
      <Card>
        <View className="gap-4">
          <OtpInput
            testID="otp-input"
            value={code}
            error={!!error}
            onChange={(d) => {
              setCode(d);
              setError(null);
              if (d.length === 6) void verify(d);
            }}
          />
          {error ? (
            <Text variant="caption" className="text-center" style={{ color: colors.rose[700] }}>
              {error}
            </Text>
          ) : null}
        </View>
      </Card>
      <View className="flex-row items-center justify-center gap-2">
        <Text variant="caption">{t('otp.didntGet')}</Text>
        {wait > 0 ? (
          <View className="rounded-full bg-paper-sunk px-3 py-1">
            <Text variant="caption" style={{ color: colors.ink.soft }}>
              {t('otp.resendIn', { s: wait })}
            </Text>
          </View>
        ) : (
          <Button compact kind="ghost" title={t('otp.resend')} onPress={resend} />
        )}
      </View>
      <Button compact kind="ghost" title={t('otp.changePhone')} onPress={() => router.back()} />
    </OnboardingScreen>
  );
}
