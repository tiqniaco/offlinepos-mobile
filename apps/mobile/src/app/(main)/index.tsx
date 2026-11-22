import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { getDb } from '../../db/client';
import { activeUserCount } from '../../domain/auth/users';
import { LicenceBanner } from '../../features/LicenceBanner';
import { HomeView, type SetupTask } from '../../features/home/HomeView';
import { dateLabel } from '../../lib/format';

export default function Home() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const business = useApp((s) => s.business);
  const licence = useApp((s) => s.licence);
  const [users, setUsers] = useState(1);

  useFocusEffect(
    useCallback(() => {
      void activeUserCount(getDb()).then(setUsers);
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
    { key: 'products', title: t('home.taskProducts'), icon: 'list', hue: 'rose', done: false, soon: true },
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
    />
  );
}
