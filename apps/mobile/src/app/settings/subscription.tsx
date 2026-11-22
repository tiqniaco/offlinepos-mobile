import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { Screen, Text, Card, Button } from '../../ui';
import { useApp } from '../../state/app';
import { backgroundCheckin } from '../../state/boot';
import { LicenceBanner } from '../../features/LicenceBanner';

/** Licence status. Buying a plan (store billing) arrives in Phase 6. */
export default function Subscription() {
  const { t, i18n } = useTranslation();
  const l = useApp((s) => s.licence);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = DEFAULT_PLANS.find((p) => p.code === l?.plan);
  const planName = plan ? (i18n.language === 'en' ? plan.nameEn : plan.nameAr) : (l?.plan ?? '—');
  const refresh = async () => {
    setBusy(true);
    const r = await backgroundCheckin(true).catch(() => null);
    setMsg(r?.outcome === 'ok' ? t('subscription.updated') : r?.outcome === 'offline' ? t('subscription.offline') : t('errors.unknown'));
    setBusy(false);
  };
  return (
    <Screen back title={t('more.subscription')}>
      <LicenceBanner />
      <Card>
        <View className="gap-2">
          <Text variant="caption">{t('subscription.plan')}</Text>
          <Text variant="title">{planName}</Text>
        </View>
      </Card>
      <Button kind="secondary" title={busy ? t('subscription.checking') : t('licence.checkNow')} loading={busy} onPress={refresh} />
      {msg ? <Text variant="caption">{msg}</Text> : null}
    </Screen>
  );
}
