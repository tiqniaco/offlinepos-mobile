import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizePhone } from '@daftarak/shared';
import { EGYPT_ONLY, isEgyptianMobile } from '../../config/market';
import { View } from 'react-native';
import { OnboardingScreen, Button, PhoneField, Banner, Card, IconBadge, Text } from '../../ui';
import { api } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useOnboarding } from '../../state/app';
import i18n from '../../i18n';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState(useOnboarding.getState().phone);
  const reset = useOnboarding((s) => s.mode === 'reset');
  const signup = useOnboarding((s) => s.mode === 'signup');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Sign-up with a number that already has a shop (new phone / app reinstalled): sign in instead of starting over.
  const [existing, setExisting] = useState<{ phone: string; hasPassword: boolean } | null>(null);

  const toLogin = () => {
    useOnboarding.getState().set({ phone: existing!.phone });
    router.replace('/login');
  };
  const viaCode = async (phone: string) => {
    await api.requestOtp(phone, i18n.language === 'en' ? 'en' : 'ar');
    useOnboarding.getState().set({ phone });
    router.push('/otp');
  };

  const submit = async () => {
    if (busy) return;
    const phone = (() => { const p = normalizePhone(raw); return p && (!EGYPT_ONLY || isEgyptianMobile(p)) ? p : null; })();
    if (!phone) return setError(t('phone.invalid'));
    setError(null);
    setBusy(true);
    try {
      if (signup && existing?.phone !== phone) {
        const chk = await api.checkPhone(phone).catch(() => null);
        if (chk?.exists) {
          setExisting({ phone, hasPassword: chk.hasPassword });
          return;
        }
      }
      setExisting(null);
      await viaCode(phone);
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
      footer={existing ? undefined : <Button testID="phone-send" title={t('phone.send')} loading={busy} onPress={submit} />}
    >
      <PhoneField testID="phone-input" value={raw} onChangeText={(v) => (setRaw(v), setExisting(null))} error={error} onSubmitEditing={submit} placeholder="01x xxxx xxxx" />
      {existing ? (
        <Card testID="phone-existing">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconBadge name="users" hue="primary" />
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{t('phone.existingTitle')}</Text>
              <Text variant="caption">{t('phone.existingBody')}</Text>
            </View>
          </View>
          <View style={{ gap: 8, marginTop: 12 }}>
            {existing.hasPassword ? <Button testID="phone-existing-login" title={t('phone.existingLogin')} onPress={toLogin} /> : null}
            <Button
              kind={existing.hasPassword ? 'secondary' : 'primary'}
              title={existing.hasPassword ? t('phone.existingCode') : t('phone.existingContinue')}
              loading={busy}
              onPress={() => void (async () => { setBusy(true); try { await viaCode(existing.phone); } catch (e) { setError(errorMessage(t, e)); } finally { setBusy(false); } })()}
            />
          </View>
        </Card>
      ) : (
        <Banner tone="info" icon="shield" text={t('welcome.point3Hint')} />
      )}
    </OnboardingScreen>
  );
}
