/**
 * «موبايل متابعة»: the owner's second phone. Read-only summary of the shop, sent by the shop's phone
 * (today, month, cash, shifts, stock, latest invoices). Refreshes every 2 minutes while open; works offline with the
 * last summary. Opens behind the phone's fingerprint / screen lock when the phone has one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import type { GetSnapshotResponse, ShopSnapshot } from '@daftarak/shared';
import { Text, Card, Button, Banner, Icon, IconBadge, Logo, colors, fonts } from '../ui';
import { Pressable } from '../ui/Press';
import { api, ApiError } from '../api/client';
import { accessToken } from '../lib/session';
import { errorMessage } from '../lib/errors';
import { dateTimeLabel, money, qty } from '../lib/format';
import { useApp } from '../state/app';
import { followedShop, lastSnapshot, leaveFollowMode, saveLastSnapshot, type FollowedShop } from '../features/follow/store';

const POLL_MS = 120_000;
const RELOCK_MS = 60_000;
const ENDED = new Set(['device_deactivated', 'wrong_device_role', 'session_revoked', 'unauthorized', 'not_found']);

function ago(t: TFunction, ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 2) return t('follow.now');
  if (m < 60) return t('follow.minutes', { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t('follow.hours', { n: h });
  return t('follow.days', { n: Math.round(h / 24) });
}

export default function Follow() {
  const { t, i18n } = useTranslation();
  const [shop, setShop] = useState<FollowedShop | null>(null);
  const [data, setData] = useState<GetSnapshotResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [locked, setLocked] = useState(true);
  const leftAt = useRef(0);

  const unlock = useCallback(async () => {
    const [hw, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).catch(() => [false, false]);
    if (!hw || !enrolled) return setLocked(false);
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('follow.unlock'), disableDeviceFallback: false, cancelLabel: t('common.cancel') });
    if (r.success) setLocked(false);
  }, [t]);

  const load = useCallback(async (s: FollowedShop | null) => {
    if (!s) return;
    try {
      const r = await api.getSnapshot(await accessToken(), s.businessId, s.deviceId);
      setData(r);
      setErr(null);
      await saveLastSnapshot(r);
    } catch (e) {
      if (e instanceof ApiError && ENDED.has(e.code)) setEnded(true);
      else if (e instanceof Error && e.message === 'signed_out') setEnded(true);
      else setErr(e instanceof ApiError && e.code === 'network' ? t('follow.offline') : errorMessage(t, e));
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      const s = await followedShop();
      setShop(s);
      setData(await lastSnapshot());
      void unlock();
      await load(s);
    })();
  }, [load, unlock]);

  useEffect(() => {
    if (locked || !shop) return;
    const id = setInterval(() => void load(shop), POLL_MS);
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') leftAt.current = Date.now();
      else {
        if (leftAt.current && Date.now() - leftAt.current > RELOCK_MS) {
          setLocked(true);
          void unlock();
        }
        void load(shop);
      }
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [locked, shop, load, unlock]);

  const leave = async (stopOnServer: boolean) => {
    if (stopOnServer && shop) await accessToken().then((tk) => api.stopDevice(tk, shop.businessId, shop.deviceId)).catch(() => undefined);
    await leaveFollowMode();
    useApp.getState().set({ status: 'onboarding' });
  };
  const confirmLeave = () =>
    Alert.alert(t('follow.stop'), t('follow.stopConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('follow.stop'), style: 'destructive', onPress: () => void leave(true) },
    ]);

  const cur = shop?.country === 'SA' ? 'SAR' : 'EGP';
  const m = (minor: number) => money(minor, cur, i18n.language);
  const s = data?.snapshot ?? null;

  if (locked) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper.DEFAULT, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 }}>
        <Logo size={64} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 30, color: colors.ink.DEFAULT, textAlign: 'center' }}>{shop?.name ?? ''}</Text>
        <Button testID="follow-unlock" icon="fingerprint" title={t('follow.unlock')} onPress={() => void unlock()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper.DEFAULT }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(shop).finally(() => setRefreshing(false)); }} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <IconBadge name="store" hue="primary" size={42} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 29, color: colors.ink.DEFAULT }} numberOfLines={1}>{data?.businessName ?? shop?.name ?? ''}</Text>
            <Text variant="caption">{t('follow.badge')}</Text>
          </View>
          <Pressable testID="follow-refresh" onPress={() => { setRefreshing(true); void load(shop).finally(() => setRefreshing(false)); }} style={{ padding: 8 }}>
            <Icon name="refresh" size={22} color={colors.primary[600]} />
          </Pressable>
        </View>

        {ended ? (
          <Banner tone="danger" title={t('follow.endedTitle')} text={t('follow.ended')} action={t('follow.backToStart')} onAction={() => void leave(false)} />
        ) : null}
        {err ? <Banner tone="warn" icon="cloudOff" text={err} /> : null}
        {data ? <Online data={data} /> : null}

        {!s ? (
          <Card>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 25, color: colors.ink.DEFAULT }}>{t('follow.waitingTitle')}</Text>
            <Text variant="caption" style={{ marginTop: 4 }}>{t('follow.waiting')}</Text>
          </Card>
        ) : (
          <Summary s={s} m={m} />
        )}

        <Button kind="secondary" icon="trash" title={t('follow.stop')} onPress={confirmLeave} />
      </ScrollView>
    </SafeAreaView>
  );

  function Online({ data: d }: { data: GetSnapshotResponse }) {
    const seen = d.mainSeenAt ?? d.receivedAt;
    const fresh = seen != null && d.serverTime - seen < 15 * 60_000;
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: fresh ? colors.leaf[100] : colors.amber[100] }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: fresh ? colors.leaf[500] : colors.amber[500] }} />
        <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 20, color: fresh ? colors.leaf[700] : colors.amber[700] }}>
          {seen == null ? t('follow.neverSeen') : fresh ? t('follow.online') : t('follow.lastSeen', { ago: ago(t, d.serverTime - seen) })}
        </Text>
        {d.snapshot ? <Text style={{ fontSize: 11.5, color: colors.ink.mute }}>{dateTimeLabel(i18n.language, d.snapshot.at)}</Text> : null}
      </View>
    );
  }

  function Summary({ s: x, m: mm }: { s: ShopSnapshot; m: (n: number) => string }) {
    const max = Math.max(1, ...x.last14.map((d) => d.salesMinor));
    const diff = x.today.salesMinor - x.yesterdaySalesMinor;
    return (
      <>
        <Card>
          <Text variant="caption">{t('follow.todaySales')}</Text>
          <Text testID="follow-today-sales" style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 40, color: colors.ink.DEFAULT }}>{mm(x.today.salesMinor)}</Text>
          <Text style={{ fontSize: 12.5, lineHeight: 20, color: diff >= 0 ? colors.leaf[700] : colors.rose[700] }}>
            {t('follow.vsYesterday', { amount: mm(x.yesterdaySalesMinor) })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <Tile label={t('follow.invoices')} value={String(x.today.invoices)} />
            <Tile label={t('follow.profit')} value={mm(x.today.profitMinor)} />
            <Tile label={t('follow.expenses')} value={mm(x.today.expensesMinor)} />
          </View>
          {x.today.returnsMinor ? <Text variant="caption" style={{ marginTop: 8 }}>{t('follow.returns', { amount: mm(x.today.returnsMinor) })}</Text> : null}
        </Card>

        {x.today.byMethod.length ? (
          <Card>
            <Title icon="wallet" text={t('follow.received')} />
            {x.today.byMethod.map((p) => (
              <Row key={p.method} label={t(`follow.method.${p.method}`, { defaultValue: p.method })} value={mm(p.amountMinor)} />
            ))}
          </Card>
        ) : null}

        {x.shifts.length ? (
          <Card>
            <Title icon="clock" text={t('follow.openShifts')} />
            {x.shifts.map((sh, i) => (
              <Row key={i} label={`${sh.user} · ${dateTimeLabel(i18n.language, sh.openedAt)}`} value={t('follow.drawer', { amount: mm(sh.expectedCashMinor) })} />
            ))}
          </Card>
        ) : null}

        <Card>
          <Title icon="chart" text={t('follow.last14')} />
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 90, marginTop: 6 }}>
            {x.last14.map((d) => (
              <View key={d.day} style={{ flex: 1, height: Math.max(3, Math.round((Math.max(0, d.salesMinor) / max) * 86)), borderRadius: 4, backgroundColor: d.day === x.day ? colors.primary[600] : colors.primary[200] }} />
            ))}
          </View>
        </Card>

        <Card>
          <Title icon="calendar" text={t('follow.month')} />
          <Row label={t('follow.sales')} value={mm(x.month.salesMinor)} />
          <Row label={t('follow.profit')} value={mm(x.month.profitMinor)} />
          <Row label={t('follow.expenses')} value={mm(x.month.expensesMinor)} />
          <Row label={t('follow.purchases')} value={mm(x.month.purchasesMinor)} />
        </Card>

        <Card>
          <Title icon="users" text={t('follow.balances')} />
          <Row label={t('follow.receivables')} value={mm(x.receivablesMinor)} />
          <Row label={t('follow.payables')} value={mm(x.payablesMinor)} />
        </Card>

        <Card>
          <Title icon="box" text={t('follow.stock')} />
          <Row label={t('follow.stockValue')} value={mm(x.stock.valueMinor)} />
          <Row label={t('follow.low')} value={String(x.stock.low)} warn={x.stock.low > 0} />
          <Row label={t('follow.out')} value={String(x.stock.out)} warn={x.stock.out > 0} />
          {x.lowItems.map((p) => (
            <Row key={p.name} small label={p.name} value={qty(p.qtyMilli)} warn />
          ))}
        </Card>

        {x.top.length ? (
          <Card>
            <Title icon="tag" text={t('follow.top')} />
            {x.top.map((p) => (
              <Row key={p.name} label={`${p.name} · ${qty(p.qtyMilli)}`} value={mm(p.salesMinor)} />
            ))}
          </Card>
        ) : null}

        {x.recent.length ? (
          <Card>
            <Title icon="receipt" text={t('follow.recent')} />
            {x.recent.map((r, i) => (
              <Row
                key={`${r.no}-${i}`}
                small
                label={[r.type === 'RETURN' ? t('follow.return') : r.no ?? '', r.party, r.cashier, dateTimeLabel(i18n.language, r.at)].filter(Boolean).join(' · ')}
                value={r.status === 'VOIDED' ? `${mm(r.totalMinor)} · ${t('follow.voided')}` : mm(r.type === 'RETURN' ? -r.totalMinor : r.totalMinor)}
                warn={r.status === 'VOIDED' || r.type === 'RETURN'}
              />
            ))}
          </Card>
        ) : null}
      </>
    );
  }
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.paper.sunk }}>
      <Text style={{ fontSize: 11.5, lineHeight: 19, color: colors.ink.mute }}>{label}</Text>
      <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 23, color: colors.ink.DEFAULT }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

function Title({ icon, text }: { icon: 'wallet' | 'clock' | 'chart' | 'calendar' | 'users' | 'box' | 'tag' | 'receipt'; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <Icon name={icon} size={18} color={colors.primary[600]} />
      <Text style={{ fontFamily: fonts.bold, fontSize: 14.5, lineHeight: 24, color: colors.ink.DEFAULT }}>{text}</Text>
    </View>
  );
}

function Row({ label, value, warn, small }: { label: string; value: string; warn?: boolean; small?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingVertical: small ? 4 : 6 }}>
      <Text style={{ flex: 1, fontSize: small ? 12.5 : 13.5, lineHeight: small ? 20 : 22, color: colors.ink.soft }} numberOfLines={small ? 2 : 1}>{label}</Text>
      <Text style={{ fontFamily: fonts.semibold, fontSize: small ? 12.5 : 13.5, lineHeight: small ? 20 : 22, color: warn ? colors.rose[700] : colors.ink.DEFAULT }}>{value}</Text>
    </View>
  );
}
