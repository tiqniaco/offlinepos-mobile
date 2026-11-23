import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizePhone, passwordProblem } from '@daftarak/shared';
import { EGYPT_ONLY, isEgyptianMobile } from '../config/market';
import { OnboardingScreen, Button, PhoneField, PasswordField, OtpInput, Banner, Card, Text } from '../ui';
import { api } from '../api/client';
import { getDb } from '../db/client';
import { getCurrentDevice, getMeta } from '../domain/device';
import { deviceInfo } from '../domain/onboarding';
import { syncOwnerPassword, unlockWithPin } from '../domain/auth/users';
import { setSecret, SECURE_KEYS } from '../lib/secure';
import { useAccessToken } from '../lib/session';
import { errorMessage } from '../lib/errors';
import { useApp } from '../state/app';
import { fx } from '../ui/fx';
import i18n from '../i18n';

/**
 * Forgot the password on the lock screen (needs internet): SMS code to the account phone → new password →
 * saved on the server (other phones are signed out) and on this phone → open the app.
 */
export default function UnlockReset() {
  const { t } = useTranslation();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [raw, setRaw] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getMeta(getDb(), 'account.phone').then((p) => p && setRaw(`+${p}`));
  }, []);

  const phone = (() => { const p = normalizePhone(raw); return p && (!EGYPT_ONLY || isEgyptianMobile(p)) ? p : null; })();
  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setErr(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const send = () => {
    if (!phone) return setErr(t('phone.invalid'));
    return run(async () => {
      await api.requestOtp(phone, i18n.language === 'en' ? 'en' : 'ar');
      setStep('code');
    });
  };

  const save = () =>
    run(async () => {
      const p = passwordProblem(pw);
      if (p) return setErr(t(`password.problem.${p}`));
      if (pw !== pw2) return setErr(t('owner.mismatch'));
      const db = getDb();
      const auth = await api.verifyOtp(phone!, code, await deviceInfo());
      await api.setPassword(auth.accessToken, pw);
      // This phone continues on the new session (the old one was signed out by the password change).
      await setSecret(SECURE_KEYS.refreshToken, auth.refreshToken);
      useAccessToken(auth.accessToken, auth.accessExpiresAt);
      const dev = await getCurrentDevice(db);
      const ownerId = await syncOwnerPassword(db, pw, dev?.id ?? 'unknown');
      fx.success();
      const session = await unlockWithPin(db, ownerId ?? userId ?? '', pw);
      useApp.getState().unlock(session);
    });

  return (
    <OnboardingScreen
      title={t('login.forgotTitle')}
      subtitle={t('unlockReset.body')}
      footer={
        step === 'phone' ? (
          <Button title={t('phone.send')} loading={busy} onPress={() => void send()} />
        ) : step === 'code' ? (
          <Button title={t('common.next')} disabled={code.length !== 6} onPress={() => setStep('password')} />
        ) : (
          <Button title={t('password.save')} loading={busy} onPress={() => void save()} />
        )
      }
    >
      {step === 'phone' ? <PhoneField value={raw} onChangeText={setRaw} placeholder="01x xxxx xxxx" /> : null}
      {step === 'code' ? (
        <Card>
          <View className="gap-3">
            <Text variant="caption">{t('otp.body', { phone: `+${phone}` })}</Text>
            <OtpInput value={code} onChange={setCode} error={!!err} />
          </View>
        </Card>
      ) : null}
      {step === 'password' ? (
        <>
          <PasswordField label={t('login.password')} value={pw} onChangeText={setPw} autoFocus />
          <PasswordField label={t('password.confirm')} value={pw2} onChangeText={setPw2} onSubmitEditing={() => void save()} />
          <Banner tone="info" icon="shield" text={t('password.otherPhones')} />
        </>
      ) : null}
      {err ? <Banner tone="danger" text={err} /> : null}
      <Button kind="ghost" compact title={t('common.cancel')} onPress={() => router.back()} />
    </OnboardingScreen>
  );
}
