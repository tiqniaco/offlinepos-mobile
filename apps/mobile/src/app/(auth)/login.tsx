import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizePhone } from '@daftarak/shared';
import { EGYPT_ONLY, isEgyptianMobile } from '../../config/market';
import { OnboardingScreen, Button, PhoneField, PasswordField, Banner } from '../../ui';
import { api, ApiError } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useOnboarding } from '../../state/app';
import { deviceInfo } from '../../domain/onboarding';

/** Phone + password on any phone. Forgot → SMS code → new password. */
export default function Login() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(useOnboarding.getState().phone);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noPassword, setNoPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const viaSms = (mode: 'signup' | 'reset') => {
    const phone = (() => { const p = normalizePhone(raw); return p && (!EGYPT_ONLY || isEgyptianMobile(p)) ? p : null; })();
    useOnboarding.getState().set({ mode, phone: phone ?? useOnboarding.getState().phone });
    router.push('/phone');
  };

  const submit = async () => {
    if (busy) return;
    const phone = (() => { const p = normalizePhone(raw); return p && (!EGYPT_ONLY || isEgyptianMobile(p)) ? p : null; })();
    if (!phone) return setError(t('phone.invalid'));
    if (!password) return setError(t('login.enterPassword'));
    setError(null);
    setNoPassword(false);
    setBusy(true);
    try {
      const auth = await api.passwordLogin(phone, password, await deviceInfo());
      useOnboarding.getState().set({ phone, auth, password });
      router.replace(auth.businesses.length > 0 ? '/choose-business' : '/business');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'password_locked') setError(t('login.locked', { min: Math.max(1, Math.ceil(Number(e.message) / 60) || 15) }));
      else if (e instanceof ApiError && e.code === 'password_not_set') {
        setNoPassword(true);
        setError(t('login.noPassword'));
      } else setError(errorMessage(t, e));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingScreen
      title={t('login.title')}
      subtitle={t('login.body')}
      footer={
        <View className="gap-2">
          <Button testID="login-submit" title={t('login.submit')} loading={busy} onPress={() => void submit()} />
          <Button kind="ghost" compact title={t('login.forgot')} onPress={() => viaSms('reset')} />
        </View>
      }
    >
      <PhoneField testID="login-phone" value={raw} onChangeText={setRaw} placeholder="01x xxxx xxxx" />
      <PasswordField testID="login-password" label={t('login.password')} value={password} onChangeText={setPassword} onSubmitEditing={() => void submit()} />
      {error ? <Banner tone="danger" text={error} /> : null}
      {noPassword ? <Button kind="secondary" compact title={t('login.useSms')} onPress={() => viaSms('reset')} /> : null}
      <Button kind="ghost" compact title={t('login.newAccount')} onPress={() => viaSms('signup')} />
      <Button kind="ghost" compact icon="file" title={t('portable.restoreTitle')} onPress={() => router.push('/restore-file')} />
    </OnboardingScreen>
  );
}
