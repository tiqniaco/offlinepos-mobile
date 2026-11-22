import { useEffect, useState } from 'react';
import Constants from 'expo-constants';
import { Segmented } from '../../features/common/Segmented';
import { buy, configureStore, restoreStore, storeAvailable, storePlans, type StorePlan } from '../../features/billing/store';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { openWhatsApp } from '../../features/export/whatsapp';
import { TextField, Banner, Icon } from '../../ui';
import { haptic } from '../../ui/haptics';
import { fonts } from '../../ui/fonts';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { DEFAULT_PLANS, UNLIMITED } from '@daftarak/shared';
import { Screen, Text, Card, Button, SectionTitle, IconBadge, colors, shadow } from '../../ui';
import { useApp } from '../../state/app';
import { backgroundCheckin } from '../../state/boot';
import { LicenceBanner } from '../../features/LicenceBanner';

/** Licence status + subscribe (store via RevenueCat) or redeem an activation code from a sales rep. */
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
  const business = useApp((s) => s.business);
  const [plans, setPlans] = useState<StorePlan[]>([]);
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const support = (Constants.expoConfig?.extra as { supportWhatsApp?: string } | undefined)?.supportWhatsApp ?? '';
  useEffect(() => {
    if (!business?.serverBusinessId || !storeAvailable()) return;
    configureStore(business.serverBusinessId);
    void storePlans().then(setPlans, () => setPlans([]));
  }, [business?.serverBusinessId]);
  const afterChange = async (text: string) => {
    haptic.success();
    setOk(text);
    // The server learns about the purchase from the store webhook within seconds; the check-in brings the licence.
    for (const wait of [1500, 5000, 12000]) {
      await new Promise((r) => setTimeout(r, wait));
      const r = await backgroundCheckin(true).catch(() => null);
      if (r?.outcome === 'ok' && r.state.plan !== l?.plan) break;
    }
  };
  const purchase = async (p: StorePlan) => {
    setErr(null);
    try {
      if (await buy(p)) await afterChange(t('subscription.thanks'));
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };
  const redeem = async () => {
    setErr(null);
    try {
      const r = await api.redeemCode(await accessToken(), business!.serverBusinessId, code);
      setCode('');
      await afterChange(t('subscription.codeOk', { plan: DEFAULT_PLANS.find((x) => x.code === r.plan)?.[i18n.language === 'en' ? 'nameEn' : 'nameAr'] ?? r.plan }));
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };
  const FEATURE_KEYS: Record<string, string> = { no_ads: 'noAds', multi_unit: 'multiUnit', offers: 'offers', expenses_shifts: 'expenses', expiry: 'expiry', adv_reports: 'advReports', custom_roles: 'customRoles' };
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
      <SectionTitle>{t('subscription.choose')}</SectionTitle>
      {ok ? <Banner tone="success" text={ok} /> : null}
      {err ? <Banner tone="danger" text={err} /> : null}
      <Segmented value={period} onChange={setPeriod} options={[{ value: 'monthly', label: t('subscription.monthly') }, { value: 'yearly', label: t('subscription.yearly') }]} />
      {DEFAULT_PLANS.filter((p) => !p.isFree).map((p) => {
        const sp = plans.find((x) => x.plan === p.code && x.period === period);
        const cur = business?.currency ?? 'EGP';
        const listPrice = (period === 'yearly' ? p.yearly : p.monthly)[cur] / 100;
        const current = l?.plan === p.code && l.mode === 'full' && l.trialDaysLeft == null;
        return (
          <Card key={p.code} style={{ borderWidth: 2, borderColor: p.code === 'pro' ? colors.primary[500] : 'transparent' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{i18n.language === 'en' ? p.nameEn : p.nameAr}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.primary[700] }}>
                {sp?.price ?? `${listPrice.toLocaleString('en-US')} ${cur === 'SAR' ? 'ر.س' : 'ج.م'}`} / {t(period === 'yearly' ? 'subscription.perYear' : 'subscription.perMonth')}
              </Text>
            </View>
            <View style={{ gap: 3, marginVertical: 8 }}>
              {p.features.map((f) => (
                <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={15} color={colors.leaf[600]} />
                  <Text variant="body">{t(`subscription.f.${FEATURE_KEYS[f] ?? f}`)}</Text>
                </View>
              ))}
              <Text variant="caption">{t('subscription.limitsLine', { users: lim(p.limits.users), products: lim(p.limits.products) })}</Text>
            </View>
            {current ? <Banner tone="success" text={t('subscription.current')} /> : sp ? <Button testID={`buy-${p.code}`} title={t('subscription.subscribe')} onPress={() => void purchase(sp)} /> : null}
          </Card>
        );
      })}
      {storeAvailable() ? <Button kind="ghost" icon="refresh" title={t('subscription.restore')} onPress={() => void restoreStore().then(() => afterChange(t('subscription.restored')), (e) => setErr(errorMessage(t, e)))} /> : null}
      <SectionTitle>{t('subscription.codeTitle')}</SectionTitle>
      <Card>
        <Text variant="caption">{t('subscription.codeHint')}</Text>
        <View style={{ height: 8 }} />
        <TextField testID="activation-code" value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" ltr />
        <View style={{ height: 8 }} />
        <Button title={t('subscription.redeem')} disabled={code.replace(/[^A-Z0-9]/gi, '').length < 12} onPress={() => void redeem()} />
      </Card>
      {support ? <Button kind="secondary" icon="whatsapp" title={t('subscription.contactSales')} onPress={() => void openWhatsApp(support, t('subscription.salesMessage', { name: business?.name ?? '' }))} /> : null}
      <Button kind="secondary" icon="globe" title={busy ? t('subscription.checking') : t('licence.checkNow')} loading={busy} onPress={refresh} />
      {msg ? <Text variant="caption" className="text-center">{msg}</Text> : null}
    </Screen>
  );
}
