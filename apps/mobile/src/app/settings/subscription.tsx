import { useState } from 'react';
import { fonts } from '../../ui/fonts';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { DEFAULT_PLANS, UNLIMITED } from '@daftarak/shared';
import { Screen, Text, Card, Button, SectionTitle, IconBadge, colors, shadow } from '../../ui';
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
  const lim = (n: number | undefined) => (n == null ? '—' : n === UNLIMITED ? t('subscription.unlimited') : String(n));
  const refresh = async () => {
    setBusy(true);
    const r = await backgroundCheckin(true).catch(() => null);
    setMsg(r?.outcome === 'ok' ? t('subscription.updated') : r?.outcome === 'offline' ? t('subscription.offline') : t('errors.unknown'));
    setBusy(false);
  };
  const days = l?.trialDaysLeft ?? l?.graceDaysLeft;
  return (
    <Screen back title={t('more.subscription')}>
      <View style={[{ borderRadius: 22, overflow: 'hidden' }, shadow.lifted]}>
        <LinearGradient colors={[colors.primary[500], colors.primary[700], colors.primary[800]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20, gap: 6 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 20, fontFamily: fonts.medium }}>{t('subscription.plan')}</Text>
          <Text style={{ color: '#FFFFFF', fontSize: 32, lineHeight: 44, fontFamily: fonts.bold }}>{planName}</Text>
          {days != null ? (
            <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 99, paddingHorizontal: 12, paddingVertical: 4 }}>
              <Text style={{ color: colors.accent.onDark, fontSize: 13, lineHeight: 20, fontFamily: fonts.bold }}>{t('subscription.days', { n: days })}</Text>
            </View>
          ) : null}
        </LinearGradient>
      </View>
      {l && l.mode !== 'full' ? <LicenceBanner /> : null}
      <SectionTitle>{t('subscription.limits')}</SectionTitle>
      <Card>
        <View className="flex-row justify-between">
          {[
            { k: 'usersLimit', v: lim(l?.limits.users), icon: 'users' as const, hue: 'amber' as const },
            { k: 'productsLimit', v: lim(l?.limits.products), icon: 'list' as const, hue: 'sky' as const },
            { k: 'invoicesLimit', v: lim(l?.limits.invoices_month), icon: 'book' as const, hue: 'primary' as const },
          ].map((x) => (
            <View key={x.k} className="flex-1 items-center gap-1.5">
              <IconBadge name={x.icon} hue={x.hue} size={40} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 26, color: colors.ink.DEFAULT }}>{x.v}</Text>
              <Text variant="caption" className="text-center">
                {t(`subscription.${x.k}`)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      <Button kind="secondary" icon="globe" title={busy ? t('subscription.checking') : t('licence.checkNow')} loading={busy} onPress={refresh} />
      {msg ? <Text variant="caption" className="text-center">{msg}</Text> : null}
    </Screen>
  );
}
