import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OTP_POLICY, passwordProblem, type AuthResponse } from '@daftarak/shared';
import { OnboardingScreen, Button, PasswordField, OtpInput, Banner, Card, Text } from '../ui';
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

/** The SMS code must belong to an account that owns THIS phone's business. */
function ownsThisBusiness(auth: AuthResponse): boolean {
  const id = useApp.getState().business?.serverBusinessId;
  return !!id && auth.businesses.some((b) => b.id === id);
}

/**
 * Forgot the password on the lock screen (needs internet): SMS code to the account phone (read-only, from this
 * phone's records) → new password → saved on the server (other phones are signed out) and on this phone → open the app.
 */
export default function UnlockReset() {
  const { t } = useTranslation();
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const [step, setStep] = useState<'phone' | 'code' | 'password'>('phone');
  const [phone, setPhone] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [code, setCode] = useState('');
  const [auth, setAuth] = useState<AuthResponse | null>(null);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    void getMeta(getDb(), 'account.phone')
      .then((p) => setPhone(p || null))
      .catch(() => setPhone(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
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
    if (!phone) return setErr(t('unlockReset.noPhone'));
    return run(async () => {
      await api.requestOtp(phone, i18n.language === 'en' ? 'en' : 'ar');
      setCode('');
      setAuth(null);
      setWait(OTP_POLICY.resendCooldownMs / 1000);
      setStep('code');
    });
  };

  const verify = () => {
    if (!phone || code.length !== 6) return;
    return run(async () => {
      try {
        const a = await api.verifyOtp(phone, code, await deviceInfo());
        if (!ownsThisBusiness(a)) {
          setErr(t('unlockReset.otherAccount'));
          return;
        }
        setAuth(a);
        setStep('password');
      } catch (e) {
        setCode('');
        throw e;
      }
    });
  };

  const save = () =>
    run(async () => {
      if (!auth) return setStep('code');
      const p = passwordProblem(pw);
      if (p) return setErr(t(`password.problem.${p}`));
      if (pw !== pw2) return setErr(t('owner.mismatch'));
      if (!ownsThisBusiness(auth)) return setErr(t('unlockReset.otherAccount'));
      const db = getDb();
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
          <Button title={t('phone.send')} loading={busy} disabled={!phone} onPress={() => void send()} />
        ) : step === 'code' ? (
          <Button title={t('otp.verify')} loading={busy} disabled={code.length !== 6} onPress={() => void verify()} />
        ) : (
          <Button title={t('password.save')} loading={busy} onPress={() => void save()} />
        )
      }
    >
      {step === 'phone' ? (
        <Card>
          <View className="gap-1">
            <Text variant="caption">{t('unlockReset.phoneLabel')}</Text>
            {phone ? (
              <Text variant="title" style={{ writingDirection: 'ltr', textAlign: 'left' }}>{`+${phone}`}</Text>
            ) : loaded ? (
              <Text variant="caption">{t('unlockReset.noPhone')}</Text>
            ) : null}
          </View>
        </Card>
      ) : null}
      {step === 'code' ? (
        <Card>
          <View className="gap-3">
            <Text variant="caption">{t('otp.body', { phone: `+${phone}` })}</Text>
            <OtpInput value={code} onChange={setCode} error={!!err} />
            {wait > 0 ? (
              <Text variant="caption">{t('otp.resendIn', { s: wait })}</Text>
            ) : (
              <Button kind="ghost" compact title={t('otp.resend')} disabled={busy} onPress={() => void send()} />
            )}
            <Button
              kind="ghost"
              compact
              title={t('common.back')}
              disabled={busy}
              onPress={() => {
                setErr(null);
                setCode('');
                setStep('phone');
              }}
            />
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
