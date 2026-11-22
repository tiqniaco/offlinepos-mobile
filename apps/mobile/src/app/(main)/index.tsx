import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { getDb } from '../../db/client';
import { activeUserCount } from '../../domain/auth/users';
import { inventorySummary, type InventorySummary } from '../../domain/inventory/products';
import { money } from '../../lib/format';
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

  useFocusEffect(
    useCallback(() => {
      void activeUserCount(getDb()).then(setUsers);
      void inventorySummary(getDb()).then(setInv);
    }, []),
  );

  const plan = DEFAULT_PLANS.find((p) => p.code === licence?.plan);
  const planName = plan ? (i18n.language === 'en' ? plan.nameEn : plan.nameAr) : null;
  const planChip = licence?.trialDaysLeft != null ? t('licence.trial', { days: licence.trialDaysLeft }) : planName ? t('home.plan', { name: planName }) : null;
  const canManage = user.permissions.includes('users.manage');

  const tasks: SetupTask[] = [
    { key: 'owner', title: t('home.taskOwner'), icon: 'users', hue: 'teal', done: true },
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
      stats={
        inv && inv.products > 0
          ? [
              { key: 'p', label: t('home.statProducts'), value: String(inv.products), icon: 'box' as const, hue: 'teal' as const, onPress: () => router.push('/(main)/products') },
              { key: 'l', label: t('home.statLow'), value: String(inv.lowStock), icon: 'warning' as const, hue: inv.lowStock ? ('amber' as const) : ('leaf' as const), onPress: () => router.push('/(main)/products') },
              ...(user.permissions.includes('cost.view')
                ? [{ key: 'v', label: t('home.statValue'), value: money(inv.stockValueMinor, business?.currency ?? 'EGP', i18n.language), icon: 'layers' as const, hue: 'sky' as const }]
                : []),
            ]
          : undefined
      }
    />
  );
}
