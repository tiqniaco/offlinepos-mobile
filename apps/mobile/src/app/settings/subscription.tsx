import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import { Segmented } from '../../features/common/Segmented';
import { buy, configureStore, restoreStore, storeAvailable, storePlans, type StorePlan } from '../../features/billing/store';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage, withCode } from '../../lib/errors';
import { openWhatsApp } from '../../features/export/whatsapp';
import { TextField, Banner, Icon } from '../../ui';
import { fx } from '../../ui/fx';
import { fonts } from '../../ui/fonts';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { DEFAULT_PLANS, UNLIMITED, type ManualBillingInfo, type PaymentRequestSummary } from '@daftarak/shared';
import { Screen, Text, Card, Button, SectionTitle, IconBadge, colors, shadow } from '../../ui';
import { useApp } from '../../state/app';
import { backgroundCheckin } from '../../state/boot';
import { LicenceBanner } from '../../features/LicenceBanner';
import { isStoreBuild } from '../../features/update/update';
import { ReauthCard } from '../../features/licence/ReauthCard';

/** A plan as shown here: live prices / limits from the server (billingInfo); DEFAULT_PLANS only when offline. */
interface ShownPlan {
  code: string;
  nameAr: string;
  nameEn: string;
  monthly: { EGP: number; SAR: number };
  yearly: { EGP: number; SAR: number };
  limits: Record<string, number>;
  features: string[];
}
const fallbackPlans = (): ShownPlan[] => DEFAULT_PLANS.filter((p) => !p.isFree).map((p) => ({ code: p.code, nameAr: p.nameAr, nameEn: p.nameEn, monthly: p.monthly, yearly: p.yearly, limits: { ...p.limits }, features: [...p.features] }));
function fromServer(info: ManualBillingInfo): ShownPlan[] {
  return info.plans.map((p) => {
    const d = DEFAULT_PLANS.find((x) => x.code === p.code);
    return {
      code: p.code,
      nameAr: p.nameAr,
      nameEn: p.nameEn,
      monthly: { EGP: p.monthlyMinor, SAR: p.monthlySarMinor ?? d?.monthly.SAR ?? 0 },
      yearly: { EGP: p.yearlyMinor, SAR: p.yearlySarMinor ?? d?.yearly.SAR ?? 0 },
      limits: p.limits,
      features: p.features,
    };
  });
}
/** Feature not built yet: never advertised (old servers may still list it). */
const HIDDEN_FEATURES = new Set(['custom_roles']);

/** Licence status + subscribe (store via RevenueCat) or redeem an activation code from a sales rep. */
export default function Subscription() {
  const { t, i18n } = useTranslation();
  const l = useApp((s) => s.licence);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogue, setCatalogue] = useState<ShownPlan[]>(fallbackPlans);
  const nameOf = (code: string | undefined) => {
    const p = catalogue.find((x) => x.code === code) ?? DEFAULT_PLANS.find((x) => x.code === code);
    return p ? (i18n.language === 'en' ? p.nameEn : p.nameAr) : (code ?? '—');
  };
  const planName = nameOf(l?.plan);
  const storeBuild = isStoreBuild();
  // A store build sells only through the store: until its billing is set up, no prices or plan buttons (store policy).
  const canBuy = !storeBuild || storeAvailable();
  const lim = (n: number | undefined) => (n == null ? '—' : n === UNLIMITED ? t('subscription.unlimited') : String(n));
  const refresh = async () => {
    setBusy(true);
    const r = await backgroundCheckin(true).catch(() => null);
    setMsg(r?.outcome === 'ok' ? t('subscription.updated') : r?.outcome === 'offline' ? t('subscription.offline') : r?.outcome === 'signed_out' || r?.outcome === 'not_registered' ? t('licence.signedOut') : withCode(t, r?.detail ?? r?.outcome));
    setBusy(false);
  };
  const days = l?.trialDaysLeft ?? l?.graceDaysLeft;
  const business = useApp((s) => s.business);
  const [plans, setPlans] = useState<StorePlan[]>([]);
  const [period, setPeriod] = useState<'monthly' | 'yearly'>('yearly');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [requests, setRequests] = useState<PaymentRequestSummary[]>([]);
  useFocusEffect(
    useCallback(() => {
      const id = business?.serverBusinessId;
      if (!id) return;
      let alive = true;
      void (async () => {
        try {
          const info = await api.billingInfo(await accessToken(), id);
          if (alive && info.plans.length) setCatalogue(fromServer(info));
        } catch {
          /* offline: DEFAULT_PLANS stay as the fallback */
        }
        try {
          const r = await api.listPaymentRequests(await accessToken(), id);
          if (!alive) return;
          setRequests(r.requests);
          // An approved request may not be in the licence yet: refresh it.
          if (r.requests.some((x) => x.status === 'approved' && x.reviewedAt && x.reviewedAt > Date.now() - 86_400_000)) void backgroundCheckin(true).catch(() => null);
        } catch {
          /* offline: keep the list empty */
        }
      })();
      return () => {
        alive = false;
      };
    }, [business?.serverBusinessId]),
  );
  const support = (Constants.expoConfig?.extra as { supportWhatsApp?: string } | undefined)?.supportWhatsApp ?? '';
  useEffect(() => {
    if (!business?.serverBusinessId || !storeAvailable()) return;
    configureStore(business.serverBusinessId);
    void storePlans().then(setPlans, () => setPlans([]));
  }, [business?.serverBusinessId]);
  const afterChange = async (text: string) => {
    fx.success();
    setOk(text);
    // The server learns about the purchase from the store webhook within seconds; the check-in brings the licence.
    for (const wait of [1500, 5000, 12000]) {
      await new Promise((r) => setTimeout(r, wait));
      const r = await backgroundCheckin(true).catch(() => null);
      if (r?.outcome === 'ok' && r.state.plan !== l?.plan) break;
    }
  };
  // One store purchase / code redemption at a time (double taps must not charge or redeem twice).
  const [working, setWorking] = useState<string | null>(null);
  const workingRef = useRef(false);
  const once = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    if (workingRef.current) return undefined;
    workingRef.current = true;
    setWorking(key);
    setErr(null);
    try {
      return await fn();
    } catch (e) {
      setErr(errorMessage(t, e));
      return undefined;
    } finally {
      workingRef.current = false;
      setWorking(null);
    }
  };
  const purchase = async (p: StorePlan) => {
    const bought = await once(`buy-${p.plan}`, () => buy(p));
    if (bought) await afterChange(t('subscription.thanks'));
  };
  const redeem = async () => {
    const r = await once('redeem', async () => api.redeemCode(await accessToken(), business!.serverBusinessId, code));
    if (!r) return;
    setCode('');
    await afterChange(t('subscription.codeOk', { plan: nameOf(r.plan) }));
  };
  const FEATURE_KEYS: Record<string, string> = { no_ads: 'noAds', multi_unit: 'multiUnit', offers: 'offers', expenses_shifts: 'expenses', expiry: 'expiry', adv_reports: 'advReports' };
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
      <ReauthCard onDone={() => setMsg(t('subscription.updated'))} />
      <SectionTitle>{t('subscription.limits')}</SectionTitle>
      <Card>
        <View className="flex-row justify-between">
          {[
            { k: 'usersLimit', v: lim(l?.limits.users), icon: 'users' as const, hue: 'amber' as const },
            { k: 'productsLimit', v: lim(l?.limits.products), icon: 'list' as const, hue: 'sky' as const },
            { k: 'invoicesLimit', v: lim(l?.limits.invoices_month), icon: 'book' as const, hue: 'primary' as const },
            { k: 'ocrLimit', v: lim(l?.limits.ocr_month ?? 0), icon: 'scan' as const, hue: 'leaf' as const },
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
      {canBuy ? (
        <>
      <SectionTitle>{t('subscription.choose')}</SectionTitle>
      {ok ? <Banner tone="success" text={ok} /> : null}
      {err ? <Banner tone="danger" text={err} /> : null}
      <Segmented value={period} onChange={setPeriod} options={[{ value: 'monthly', label: t('subscription.monthly') }, { value: 'yearly', label: t('subscription.yearly') }]} />
      {catalogue.map((p) => {
        const sp = plans.find((x) => x.plan === p.code && x.period === period);
        const cur = business?.currency ?? 'EGP';
        const listPrice = (period === 'yearly' ? p.yearly : p.monthly)[cur] / 100;
        const current = l?.plan === p.code && l.mode === 'full' && l.trialDaysLeft == null;
        const ocr = p.limits.ocr_month ?? 0;
        const manual = () => router.push({ pathname: '/settings/upgrade', params: { plan: p.code, period } });
        return (
          <Card key={p.code} style={{ borderWidth: 2, borderColor: p.code === 'pro' ? colors.primary[500] : 'transparent' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{i18n.language === 'en' ? p.nameEn : p.nameAr}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.primary[700] }}>
                {sp?.price ?? `${listPrice.toLocaleString('en-US')} ${cur === 'SAR' ? 'ر.س' : 'ج.م'}`} / {t(period === 'yearly' ? 'subscription.perYear' : 'subscription.perMonth')}
              </Text>
            </View>
            <View style={{ gap: 3, marginVertical: 8 }}>
              {p.features.filter((f) => !HIDDEN_FEATURES.has(f)).map((f) => (
                <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={15} color={colors.leaf[600]} />
                  <Text variant="body">{t(`subscription.f.${FEATURE_KEYS[f] ?? f}`)}</Text>
                </View>
              ))}
              {ocr !== 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={15} color={colors.leaf[600]} />
                  <Text variant="body">{ocr < 0 ? t('subscription.f.ocrUnlimited') : t('subscription.f.ocr', { n: ocr })}</Text>
                </View>
              ) : null}
              <Text variant="caption">{t('subscription.limitsLine', { users: lim(p.limits.users), products: lim(p.limits.products) })}</Text>
            </View>
            {current ? (
              <View style={{ gap: 8 }}>
                <Banner tone="success" text={t('subscription.current')} />
                {/* Early renewal of the running plan: the paid days are added after the current expiry. */}
                {!storeBuild ? <Button testID={`renew-${p.code}`} kind="secondary" icon="refresh" title={t('subscription.renew')} onPress={manual} /> : null}
              </View>
            ) : (
              <View style={{ gap: 8 }}>
                {sp ? <Button testID={`buy-${p.code}`} title={t('subscription.subscribe')} loading={working === `buy-${p.code}`} disabled={!!working} onPress={() => void purchase(sp)} /> : null}
                {/* Store builds: the store's own billing only (store policy) — no manual transfer. */}
                {!storeBuild ? <Button testID={`manual-${p.code}`} kind={sp ? 'secondary' : 'primary'} icon="wallet" title={sp ? t('upgrade.payManual') : t('subscription.subscribe')} onPress={manual} /> : null}
              </View>
            )}
          </Card>
        );
      })}
        </>
      ) : (
        <Banner tone="info" icon="card" text={t('subscription.storeSoon')} />
      )}
      {requests.length ? (
        <>
          <SectionTitle>{t('upgrade.requests')}</SectionTitle>
          {requests.map((r) => (
            <Card key={r.id}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13.5, color: colors.ink.DEFAULT }}>
                  {nameOf(r.plan) + ' · ' + t(r.period === 'yearly' ? 'subscription.perYear' : 'subscription.perMonth') + ' · ' + (r.amountMinor / 100).toLocaleString('en-US') + ' ج.م'}
                </Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 12.5, color: r.status === 'approved' ? colors.leaf[700] : r.status === 'rejected' ? colors.rose[700] : colors.amber[700] }}>{t(`upgrade.status.${r.status}`)}</Text>
              </View>
              <Text variant="caption">{new Date(r.createdAt).toLocaleString(i18n.language === 'en' ? 'en-GB' : 'ar-EG')} · {t(`upgrade.m.${r.method}`)}</Text>
              {r.status === 'rejected' && r.rejectReason ? <Text variant="caption" style={{ color: colors.rose[700] }}>{t('upgrade.rejectReason', { reason: r.rejectReason })}</Text> : null}
            </Card>
          ))}
        </>
      ) : null}
      {storeAvailable() ? <Button kind="ghost" icon="refresh" title={t('subscription.restore')} onPress={() => void restoreStore().then(() => afterChange(t('subscription.restored')), (e) => setErr(errorMessage(t, e)))} /> : null}
      {!storeBuild ? (
        <>
          <SectionTitle>{t('subscription.codeTitle')}</SectionTitle>
          <Card>
            <Text variant="caption">{t('subscription.codeHint')}</Text>
            <View style={{ height: 8 }} />
            <TextField testID="activation-code" value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoCapitalize="characters" ltr />
            <View style={{ height: 8 }} />
            <Button title={t('subscription.redeem')} loading={working === 'redeem'} disabled={!!working || code.replace(/[^A-Z0-9]/gi, '').length < 12} onPress={() => void redeem()} />
          </Card>
        </>
      ) : null}
      {support ? <Button kind="secondary" icon="whatsapp" title={t('subscription.contactSales')} onPress={() => void openWhatsApp(support, t('subscription.salesMessage', { name: business?.name ?? '' }))} /> : null}
      <Button kind="secondary" icon="globe" title={busy ? t('subscription.checking') : t('licence.checkNow')} loading={busy} onPress={refresh} />
      {msg ? <Text variant="caption" className="text-center">{msg}</Text> : null}
    </Screen>
  );
}
