import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas, DEFAULT_PLANS } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { APP_VERSION } from '../../config/env';
import { MoreView, type MoreItem } from '../../features/more/MoreView';

export default function More() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device);
  const business = useApp((s) => s.business);
  const licence = useApp((s) => s.licence);
  const lang = useApp((s) => s.settings.language ?? 'ar');
  const minutes = useApp((s) => s.settings.autoLockMinutes ?? 5);
  const can = (p: Parameters<typeof roleHas>[1]) => roleHas(user.permissions, p);
  const plan = DEFAULT_PLANS.find((p) => p.code === licence?.plan);

  const account: MoreItem[] = [];
  if (can('users.manage')) account.push({ key: 'users', testID: 'more-users', icon: 'users', hue: 'amber', title: t('more.users'), onPress: () => router.push('/settings/users') });
  if (can('subscription.manage'))
    account.push({ key: 'sub', icon: 'card', hue: 'teal', title: t('more.subscription'), value: plan ? (i18n.language === 'en' ? plan.nameEn : plan.nameAr) : undefined, onPress: () => router.push('/settings/subscription') });
  if (can('settings.manage')) account.push({ key: 'audit', icon: 'list', hue: 'ink', title: t('more.audit'), onPress: () => router.push('/settings/audit') });

  const app: MoreItem[] = [
    { key: 'security', testID: 'more-security', icon: 'shield', hue: 'sky', title: t('more.security'), value: minutes ? t('security.minutes', { n: minutes }) : t('security.never'), onPress: () => router.push('/settings/security') },
    { key: 'lang', icon: 'globe', hue: 'leaf', title: t('more.language'), value: t(`language.${lang}`), onPress: () => router.push('/settings/language') },
  ];

  return (
    <MoreView
      userName={user.name}
      userColor={user.color}
      roleName={user.roleName}
      businessName={business?.name ?? ''}
      account={account}
      app={app}
      onLock={() => useApp.getState().lock()}
      footer={`${t('app.name')} ${APP_VERSION} · ${t('more.about')} · ${device?.code ?? ''}`}
    />
  );
}
