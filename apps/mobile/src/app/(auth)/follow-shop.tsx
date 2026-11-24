import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OnboardingScreen, Text, Button, Card, Banner, Icon, colors, fonts } from '../../ui';
import { useApp, useOnboarding } from '../../state/app';
import { api, ApiError } from '../../api/client';
import { StepUpCode } from '../../features/auth/StepUpCode';
import { deviceInfo } from '../../domain/onboarding';
import { integrityToken } from '../../features/integrity/integrity';
import { setSecret, SECURE_KEYS } from '../../lib/secure';
import { useAccessToken } from '../../lib/session';
import { saveFollowedShop } from '../../features/follow/store';
import { errorMessage } from '../../lib/errors';

/** «موبايل متابعة»: follow an existing shop from this phone, read-only. The shop stays on its phone. */
export default function FollowShop() {
  const { t } = useTranslation();
  const draft = useOnboarding();
  const shop = draft.auth?.businesses.find((b) => b.id === draft.existingBusinessId);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!draft.auth || !shop) {
    return (
      <OnboardingScreen title={t('follow.title')}>
        <Button title={t('common.back')} onPress={() => router.back()} />
      </OnboardingScreen>
    );
  }
  const auth = draft.auth;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.followShop(auth.accessToken, shop.id, await deviceInfo(), await integrityToken('attach'));
      await setSecret(SECURE_KEYS.refreshToken, auth.refreshToken);
      useAccessToken(auth.accessToken, auth.accessExpiresAt);
      await saveFollowedShop({ businessId: r.business.id, deviceId: r.deviceId, name: r.business.name, country: r.business.country });
      draft.reset();
      useApp.getState().set({ status: 'follower' });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'step_up_required') setAsking(true);
      setErr(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const points: [string, string][] = [
    ['chart', t('follow.p1')],
    ['clock', t('follow.p2')],
    ['lock', t('follow.p3')],
    ['phone', t('follow.p4')],
  ];
  return (
    <OnboardingScreen
      title={t('follow.title')}
      subtitle={t('follow.subtitle', { name: shop.name })}
      footer={asking ? undefined : <Button testID="follow-start" icon="eye" title={busy ? t('common.loading') : t('follow.start')} loading={busy} onPress={() => setAsking(true)} />}
    >
      {asking ? (
        <StepUpCode
          token={auth.accessToken}
          onCancel={() => setAsking(false)}
          onVerified={async () => {
            setAsking(false);
            await start();
          }}
        />
      ) : null}
      <Card>
        <View style={{ gap: 12 }}>
          {points.map(([icon, text]) => (
            <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name={icon as 'chart'} size={20} color={colors.primary[600]} />
              <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 14, lineHeight: 23, color: colors.ink.DEFAULT }}>{text}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Banner tone="info" icon="card" text={t('follow.planNote')} />
      {err ? <Banner tone="danger" text={err} /> : null}
    </OnboardingScreen>
  );
}
