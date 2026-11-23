import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizePhone } from '@daftarak/shared';
import { EGYPT_ONLY, isEgyptianMobile } from '../../config/market';
import { OnboardingScreen, Button, PhoneField, Banner } from '../../ui';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useOnboarding } from '../../state/app';
import i18n from '../../i18n';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(useOnboarding.getState().phone);
  const reset = useOnboarding((s) => s.mode === 'reset');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const phone = (() => { const p = normalizePhone(raw); return p && (!EGYPT_ONLY || isEgyptianMobile(p)) ? p : null; })();
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
    <OnboardingScreen
      step={1}
      stepLabel={t('onboarding.step', { n: 1, total: 4 })}
      title={reset ? t('login.forgotTitle') : t('phone.title')}
      subtitle={reset ? t('login.forgotBody') : t('phone.body')}
      footer={<Button testID="phone-send" title={t('phone.send')} loading={busy} onPress={submit} />}
    >
      <PhoneField testID="phone-input" value={raw} onChangeText={setRaw} error={error} onSubmitEditing={submit} placeholder="01x xxxx xxxx" />
      <Banner tone="info" icon="shield" text={t('welcome.point3Hint')} />
    </OnboardingScreen>
  );
}
