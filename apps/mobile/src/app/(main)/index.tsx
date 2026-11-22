import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { getDb } from '../../db/client';
import { activeUserCount } from '../../domain/auth/users';
import { inventorySummary, type InventorySummary } from '../../domain/inventory/products';
import { money } from '../../lib/format';
import { todaySummary } from '../../domain/sales/sales';
import { businessDay } from '@daftarak/shared';
import { LicenceBanner } from '../../features/LicenceBanner';
import { HomeView, type SetupTask } from '../../features/home/HomeView';
import { dateLabel } from '../../lib/format';

export default function Home() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const business = useApp((s) => s.business);
  const licence = useApp((s) => s.licence);
  const [users, setUsers] = useState(1);
  const [inv, setInv] = useState<InventorySummary | null>(null);
  const [today, setToday] = useState<Awaited<ReturnType<typeof todaySummary>> | null>(null);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');

  useFocusEffect(
    useCallback(() => {
      void activeUserCount(getDb()).then(setUsers);
      void inventorySummary(getDb()).then(setInv);
      void todaySummary(getDb(), businessDay(Date.now(), tz)).then(setToday);
    }, [tz]),
  );

  const plan = DEFAULT_PLANS.find((p) => p.code === licence?.plan);
  const planName = plan ? (i18n.language === 'en' ? plan.nameEn : plan.nameAr) : null;
  const planChip = licence?.trialDaysLeft != null ? t('licence.trial', { days: licence.trialDaysLeft }) : planName ? t('home.plan', { name: planName }) : null;
  const canManage = user.permissions.includes('users.manage');

  const tasks: SetupTask[] = [
    { key: 'owner', title: t('home.taskOwner'), icon: 'users', hue: 'primary', done: true },
    ...(canManage ? [{ key: 'team', title: t('home.taskTeam'), icon: 'users' as const, hue: 'amber' as const, done: users > 1, onPress: () => router.push('/settings/users') }] : []),
    { key: 'lock', title: t('home.taskLock'), icon: 'fingerprint', hue: 'sky', done: user.biometricEnabled, onPress: () => router.push('/settings/security') },
    { key: 'products', title: inv?.products ? t('home.taskProductsDone') : t('home.taskProducts'), icon: 'box', hue: 'rose', done: !!inv?.products, onPress: () => router.push('/(main)/products') },
  ];
  const showBanner = licence && licence.mode !== 'full';

  return (
    <HomeView
      greeting={t(new Date().getHours() < 15 ? 'home.greeting' : 'home.greetingEvening', { name: user.name })}
      userName={user.name}
      userColor={user.color}
      businessName={business?.name ?? ''}
      dateLabel={dateLabel(i18n.language)}
      planChip={planChip}
      banner={showBanner ? <LicenceBanner /> : null}
      tasks={tasks}
      onLock={() => useApp.getState().lock()}
      onSell={user.permissions.includes('sales.create') ? () => router.push('/(main)/sell') : undefined}
      stats={
        inv && inv.products > 0
          ? [
              ...(today
                ? [{ key: 's', label: t('home.todayInvoices', { n: today.invoices }), value: money(today.salesMinor - today.returnsMinor, business?.currency ?? 'EGP', i18n.language), icon: 'card' as const, hue: 'primary' as const, onPress: () => router.push('/sales') }]
                : []),
              { key: 'p', label: t('home.statProducts'), value: String(inv.products), icon: 'box' as const, hue: 'primary' as const, onPress: () => router.push('/(main)/products') },
              { key: 'l', label: t('home.statLow'), value: String(inv.lowStock), icon: 'warning' as const, hue: inv.lowStock ? ('amber' as const) : ('leaf' as const), onPress: () => router.push('/(main)/products') },

            ]
          : undefined
      }
    />
  );
}
