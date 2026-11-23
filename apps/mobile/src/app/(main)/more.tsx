import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas, DEFAULT_PLANS } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { APP_VERSION } from '../../config/env';
import { MoreView, type MoreItem } from '../../features/more/MoreView';
import { PALETTES, useTheme } from '../../ui';

export default function More() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device);
  const business = useApp((s) => s.business);
  const licence = useApp((s) => s.licence);
  const lang = useApp((s) => s.settings.language ?? 'ar');
  const minutes = useApp((s) => s.settings.autoLockMinutes ?? 5);
  const palette = useTheme((s) => s.palette);
  const can = (p: Parameters<typeof roleHas>[1]) => roleHas(user.permissions, p);
  const plan = DEFAULT_PLANS.find((p) => p.code === licence?.plan);

  const account: MoreItem[] = [];
  if (can('users.manage')) account.push({ key: 'users', testID: 'more-users', icon: 'users', hue: 'amber', title: t('more.users'), onPress: () => router.push('/settings/users') });
  if (can('subscription.manage'))
    account.push({ key: 'sub', icon: 'card', hue: 'primary', title: t('more.subscription'), value: plan ? (i18n.language === 'en' ? plan.nameEn : plan.nameAr) : undefined, onPress: () => router.push('/settings/subscription') });
  if (can('settings.manage')) account.push({ key: 'audit', icon: 'list', hue: 'ink', title: t('more.audit'), onPress: () => router.push('/settings/audit') });

  account.unshift({ key: 'invoices', icon: 'card', hue: 'primary', title: t('more.invoices'), onPress: () => router.push('/sales') });
  const money: MoreItem[] = [
    ...(can('reports.view') ? [{ key: 'reports', icon: 'chart' as const, hue: 'sky' as const, title: t('more.reports'), onPress: () => router.push('/reports') }] : []),
    ...(can('purchases.manage') ? [{ key: 'purchases', icon: 'cart' as const, hue: 'primary' as const, title: t('more.purchases'), onPress: () => router.push('/purchases') }] : []),
    ...(can('parties.manage') || can('purchases.manage') || can('expenses.manage') || can('shift.manage') ? [{ key: 'vouchers', icon: 'receipt' as const, hue: 'leaf' as const, title: t('more.vouchers'), onPress: () => router.push('/vouchers') }] : []),
    ...(can('expenses.manage') ? [{ key: 'expenses', icon: 'wallet' as const, hue: 'rose' as const, title: t('more.expenses'), onPress: () => router.push('/expenses') }] : []),
    // Cashiers open/close their own shift (sales.create); shift.manage covers everyone else's.
    ...(can('sales.create') || can('shift.manage') ? [{ key: 'shifts', icon: 'clock' as const, hue: 'ink' as const, title: t('more.shifts'), onPress: () => router.push('/shifts') }] : []),
    ...(can('products.manage') ? [{ key: 'offers', icon: 'tag' as const, hue: 'leaf' as const, title: t('more.offers'), onPress: () => router.push('/offers') }] : []),
  ];
  if (can('backup.manage')) account.push({ key: 'backup', testID: 'more-backup', icon: 'upload', hue: 'leaf', title: t('more.backup'), onPress: () => router.push('/settings/backup') });
  if (can('users.manage')) account.push({ key: 'sessions', icon: 'phone', hue: 'sky', title: t('more.sessions'), onPress: () => router.push('/settings/sessions') });
  if (can('settings.manage')) account.push({ key: 'selling', icon: 'cart', hue: 'amber', title: t('more.selling'), onPress: () => router.push('/settings/selling') });
  if (can('settings.manage')) account.push({ key: 'integrity', icon: 'shield', hue: 'leaf', title: t('more.integrity'), onPress: () => router.push('/settings/integrity') });
  const app: MoreItem[] = [
    { key: 'inbox', testID: 'more-inbox', icon: 'bell', hue: 'primary', title: t('more.inbox'), onPress: () => router.push('/inbox') },
    { key: 'printers', icon: 'printer', hue: 'amber', title: t('more.printers'), onPress: () => router.push('/settings/printers') },
    { key: 'templates', icon: 'receipt', hue: 'primary', title: t('templates.title'), onPress: () => router.push('/settings/templates') },
    { key: 'security', testID: 'more-security', icon: 'shield', hue: 'sky', title: t('more.security'), value: minutes ? t(minutes >= 3 && minutes <= 10 ? 'security.minutesFew' : 'security.minutes', { n: minutes }) : t('security.never'), onPress: () => router.push('/settings/security') },
    { key: 'appearance', testID: 'more-appearance', icon: 'image', hue: 'primary', title: t('more.appearance'), value: PALETTES.find((p) => p.id === palette)?.[i18n.language === 'en' ? 'nameEn' : 'nameAr'], onPress: () => router.push('/settings/appearance') },
    { key: 'lang', icon: 'globe', hue: 'leaf', title: t('more.language'), value: t(`language.${lang}`), onPress: () => router.push('/settings/language') },
  ];

  return (
    <MoreView
      userName={user.name}
      userColor={user.color}
      roleName={user.roleName}
      businessName={business?.name ?? ''}
      account={account}
      money={money}
      app={app}
      onLock={() => useApp.getState().lock()}
      footer={`${t('app.name')} ${APP_VERSION} · ${t('more.about')} · ${device?.code ?? ''}`}
    />
  );
}
