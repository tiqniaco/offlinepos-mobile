import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { DEFAULT_PLANS, businessDay, roleHas } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { getDb } from '../../db/client';
import { activeUserCount } from '../../domain/auth/users';
import { inventorySummary, type InventorySummary } from '../../domain/inventory/products';
import { todaySummary } from '../../domain/sales/sales';
import { dashboard, type Dashboard } from '../../domain/reports/reports';
import { partyTotals } from '../../domain/parties/parties';
import { customersDue } from '../../domain/parties/statement';
import { currentShift } from '../../domain/shifts/shifts';
import { verifyChain } from '../../domain/integrity/chain';
import { planNotifications } from '../../features/notify/notify';
import { latestUnread, unreadCount } from '../../domain/inbox/inbox';
import { addSampleData, hasSampleData, removeSampleData } from '../../domain/sample/sample';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';
import { Tip } from '../../features/Tip';
import { LicenceBanner } from '../../features/LicenceBanner';
import { HomeView, type SetupTask } from '../../features/home/HomeView';
import type { Tile } from '../../features/common/ActionTiles';
import { Banner, Icon, Text, colors, fonts } from '../../ui';
import { money, dateLabel } from '../../lib/format';

let integrityCheckedDay = 0;
/** Reminders are re-planned once per app start and day (not on every focus of the home tab). */
let notifyPlannedDay = 0;

export default function Home() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device);
  const business = useApp((s) => s.business);
  const licence = useApp((s) => s.licence);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const reminderDays = useApp((s) => s.settings.reminderDays ?? 30);
  const requireShift = useApp((s) => !!s.settings.requireShift);
  const [users, setUsers] = useState(1);
  const [inv, setInv] = useState<InventorySummary | null>(null);
  const [today, setToday] = useState<Awaited<ReturnType<typeof todaySummary>> | null>(null);
  const [owedToUs, setOwedToUs] = useState(0);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [late, setLate] = useState(0);
  const [shiftOpen, setShiftOpen] = useState(true);
  const [tamper, setTamper] = useState(false);
  const [sample, setSample] = useState(false);
  const inboxBump = useApp((s) => s.inboxBump);
  const [unread, setUnread] = useState(0);
  const [news, setNews] = useState<Awaited<ReturnType<typeof latestUnread>>>(null);
  const invCtx = useInvCtx();
  const [bioAvailable, setBioAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(
      ([h, e]) => setBioAvailable(h && e),
      () => setBioAvailable(false),
    );
  }, []);
  const sampleBusy = useRef(false);
  const trySample = async () => {
    if (!invCtx || sampleBusy.current) return;
    sampleBusy.current = true;
    try {
      const n = await addSampleData(invCtx, cur);
      setSample(true);
      void inventorySummary(getDb()).then(setInv);
      toast(t('home.sampleAdded', { n }), 'success');
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      sampleBusy.current = false;
    }
  };
  const dropSample = async () => {
    if (!invCtx || sampleBusy.current) return;
    sampleBusy.current = true;
    try {
      await removeSampleData(invCtx);
      setSample(false);
      void inventorySummary(getDb()).then(setInv);
      toast(t('home.sampleRemoved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      sampleBusy.current = false;
    }
  };
  const can = (p: Parameters<typeof roleHas>[1]) => roleHas(user.permissions, p);
  const cur = business?.currency ?? 'EGP';

  useFocusEffect(
    useCallback(() => {
      // Load after the screen transition finishes, so switching tabs stays smooth.
      const id = setTimeout(load, 220);
      return () => clearTimeout(id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tz, reminderDays, device, user.permissions, inboxBump]),
  );

  function load() {
    {
      const db = getDb();
      const day = businessDay(Date.now(), tz);
      void activeUserCount(db).then(setUsers);
      void inventorySummary(db).then(setInv);
      void todaySummary(db, day).then(setToday);
      if (roleHas(user.permissions, 'reports.view')) void dashboard(db, day).then(setDash, () => undefined);
      void partyTotals(db, 'C').then((x) => setOwedToUs(x.owedMinor));
      void customersDue(db, day, reminderDays).then((d) => setLate(d.length));
      if (device) void currentShift(db, device.id).then((s) => setShiftOpen(!!s));
      if (notifyPlannedDay !== day) {
        notifyPlannedDay = day;
        void planNotifications({ ask: false });
      }
      void hasSampleData({ db }).then(setSample);
      void unreadCount(db).then(setUnread);
      void latestUnread(db).then(setNews);
      // Daily background integrity check for owners/managers (tamper alert on the home screen).
      if (device && integrityCheckedDay !== day && roleHas(user.permissions, 'settings.manage')) {
        integrityCheckedDay = day;
        // Well after the screen settles, and in chunks that yield to the UI.
        setTimeout(() => void verifyChain(db, device.id, { yieldEvery: 50 }).then((r) => setTamper(!r.ok), () => undefined), 8000);
      }
    }
  }

  const plan = DEFAULT_PLANS.find((p) => p.code === licence?.plan);
  const planName = plan ? (i18n.language === 'en' ? plan.nameEn : plan.nameAr) : null;
  const planChip = licence?.trialDaysLeft != null ? t('licence.trial', { days: licence.trialDaysLeft }) : planName ? t('home.plan', { name: planName }) : null;

  const tasks: SetupTask[] = [
    { key: 'owner', title: t('home.taskOwner'), icon: 'users', hue: 'primary', done: true },
    ...(can('users.manage') ? [{ key: 'team', title: t('home.taskTeam'), icon: 'users' as const, hue: 'amber' as const, done: users > 1, onPress: () => router.push('/settings/users') }] : []),
    // Fingerprint lock is only a task on phones that can do it (no hardware / nothing enrolled → not shown).
    ...(bioAvailable ? [{ key: 'lock', title: t('home.taskLock'), icon: 'fingerprint' as const, hue: 'sky' as const, done: user.biometricEnabled, onPress: () => router.push('/settings/security') }] : []),
    { key: 'products', title: inv?.products ? t('home.taskProductsDone') : t('home.taskProducts'), icon: 'box', hue: 'rose', done: !!inv?.products, onPress: () => router.push('/(main)/products') },
    ...(!inv?.products && can('products.manage') ? [{ key: 'sample', title: t('home.taskSample'), icon: 'layers' as const, hue: 'sky' as const, done: false, onPress: () => void trySample() }] : []),
    ...(sample && can('products.manage') ? [{ key: 'sampleOff', title: t('home.taskSampleRemove'), icon: 'trash' as const, hue: 'rose' as const, done: false, onPress: () => void dropSample() }] : []),
  ];

  const quick: Tile[] = [
    ...(can('parties.manage') ? [{ key: 'collect', icon: 'arrowIn' as const, hue: 'leaf' as const, label: t('quick.collect'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'RECEIPT' } }) }] : []),
    ...(can('purchases.manage') ? [{ key: 'purchase', icon: 'cart' as const, hue: 'primary' as const, label: t('quick.purchase'), onPress: () => router.push('/purchases/new') }] : []),
    ...(can('purchases.manage') ? [{ key: 'pay', icon: 'arrowOut' as const, hue: 'amber' as const, label: t('quick.paySupplier'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'PAYMENT' } }) }] : []),
    ...(can('expenses.manage') ? [{ key: 'expense', icon: 'wallet' as const, hue: 'rose' as const, label: t('quick.expense'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'EXPENSE' } }) }] : []),
    { key: 'statement', icon: 'receipt', hue: 'sky', label: t('quick.statement'), onPress: () => router.push({ pathname: '/(main)/parties', params: { type: 'C', t: String(Date.now()) } }) },
    ...(can('parties.manage') ? [{ key: 'customer', icon: 'users' as const, hue: 'primary' as const, label: t('quick.newCustomer'), onPress: () => router.push({ pathname: '/parties/form', params: { type: 'C' } }) }] : []),
    ...(can('reports.view') ? [{ key: 'reports', icon: 'chart' as const, hue: 'sky' as const, label: t('quick.reports'), onPress: () => router.push('/reports') }] : can('products.manage') ? [{ key: 'product', icon: 'box' as const, hue: 'amber' as const, label: t('quick.newProduct'), onPress: () => router.push('/products/form') }] : []),
    { key: 'shift', icon: 'clock', hue: 'ink', label: t('quick.shift'), onPress: () => router.push('/shifts') },
  ];

  const alerts = (
    <>
      <Tip id="home" />
      {news ? <Banner tone="info" icon="bell" title={(i18n.language === 'en' && news.titleEn) || news.titleAr} text={(i18n.language === 'en' && news.bodyEn) || news.bodyAr} action={t('inbox.open')} onAction={() => router.push('/inbox')} /> : null}
      {tamper ? <Banner tone="danger" title={t('integrity.alertTitle')} text={t('integrity.alertBody')} action={t('integrity.open')} onAction={() => router.push('/settings/integrity')} /> : null}
      {requireShift && !shiftOpen && can('sales.create') ? <Banner tone="warn" text={t('shift.mustOpen')} action={t('shift.open')} onAction={() => router.push('/shifts')} /> : null}
      {late > 0 && can('parties.manage') ? (
        <Pressable onPress={() => router.push({ pathname: '/(main)/parties', params: { type: 'C', filter: 'late', t: String(Date.now()) } })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.amber[50], opacity: pressed ? 0.85 : 1 })}>
          <Icon name="bell" size={20} color={colors.amber[700]} />
          <Text style={{ flex: 1, color: colors.amber[700], fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 }}>{t('home.lateCustomers', { n: late })}</Text>
          <Icon name="chevron" size={16} color={colors.amber[700]} />
        </Pressable>
      ) : null}
    </>
  );

  return (
    <HomeView
      greeting={t(new Date().getHours() < 15 ? 'home.greeting' : 'home.greetingEvening', { name: user.name })}
      userName={user.name}
      userColor={user.color}
      businessName={business?.name ?? ''}
      dateLabel={dateLabel(i18n.language)}
      planChip={planChip}
      banner={licence && licence.mode !== 'full' ? <LicenceBanner /> : null}
      tasks={tasks}
      onLock={() => useApp.getState().lock()}
      onSearch={() => router.push('/search')}
      onInbox={() => router.push('/inbox')}
      unread={unread}
      onSell={can('sales.create') ? () => router.push('/sales/pos') : undefined}
      quick={quick}
      alerts={alerts}
      stats={
        today
          ? [
              { key: 's', label: t('home.todayInvoices', { n: today.invoices }), value: money(today.salesMinor - today.returnsMinor, cur, i18n.language), icon: 'card' as const, hue: 'primary' as const, onPress: () => router.push('/sales') },
              ...(dash
                ? [
                    ...(can('profit.view')
                      ? [{ key: 'p', label: t('home.todayProfit'), value: money(dash.todayProfitMinor, cur, i18n.language), icon: 'chart' as const, hue: dash.todayProfitMinor >= 0 ? ('leaf' as const) : ('rose' as const), onPress: () => router.push('/reports/pnl') }]
                      : []),
                    { key: 'm', label: t('home.monthSales'), value: money(dash.monthSalesMinor, cur, i18n.language), icon: 'calendar' as const, hue: 'sky' as const, onPress: () => router.push('/reports/sales_day') },
                  ]
                : []),
              { key: 'c', label: t('home.owedToUs'), value: money(owedToUs, cur, i18n.language), icon: 'users' as const, hue: owedToUs ? ('rose' as const) : ('leaf' as const), onPress: () => router.push({ pathname: '/(main)/parties', params: { type: 'C', filter: 'owing', t: String(Date.now()) } }) },
              ...(dash ? [{ key: 'ap', label: t('home.weOwe'), value: money(dash.payablesMinor, cur, i18n.language), icon: 'truck' as const, hue: 'amber' as const, onPress: () => router.push({ pathname: '/(main)/parties', params: { type: 'S', t: String(Date.now()) } }) }] : []),
              { key: 'l', label: t('home.statLow'), value: String(inv?.lowStock ?? 0), icon: 'warning' as const, hue: inv?.lowStock ? ('amber' as const) : ('leaf' as const), onPress: () => router.push('/(main)/products') },
            ]
          : undefined
      }
    />
  );
}
