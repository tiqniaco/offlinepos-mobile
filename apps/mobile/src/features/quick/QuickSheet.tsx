/**
 * «+» in the middle of the tab bar → the most used actions, one tap each. Sale first and biggest.
 * Actions follow the user's permissions (a cashier sees only what they may do).
 */
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { roleHas, type Permission } from '@daftarak/shared';
import { Sheet, Text, IconBadge, Icon, colors, fonts, shadow, type IconName, type Hue } from '../../ui';
import { PressableScale } from '../../ui/PressableScale';
import { useQuick } from '../../state/quick';
import { useApp } from '../../state/app';

interface Action {
  key: string;
  icon: IconName;
  hue: Hue;
  label: string;
  perm?: Permission;
  go: () => void;
}

export function QuickSheet() {
  const { t } = useTranslation();
  const open = useQuick((s) => s.open);
  const hide = useQuick((s) => s.hide);
  const perms = useApp((s) => s.user?.permissions);
  const can = (p?: Permission) => !p || (perms ? roleHas(perms, p) : false);
  const nav = (fn: () => void) => () => {
    hide();
    setTimeout(fn, 120); // let the sheet start closing first (smoother)
  };

  const actions: Action[] = [
    { key: 'purchase', icon: 'cart', hue: 'primary', label: t('quick.purchase'), perm: 'purchases.manage', go: () => router.push('/purchases/new') },
    { key: 'collect', icon: 'arrowIn', hue: 'leaf', label: t('quick.collect'), perm: 'parties.manage', go: () => router.push({ pathname: '/vouchers/new', params: { type: 'RECEIPT' } }) },
    { key: 'pay', icon: 'arrowOut', hue: 'amber', label: t('quick.paySupplier'), perm: 'purchases.manage', go: () => router.push({ pathname: '/vouchers/new', params: { type: 'PAYMENT' } }) },
    { key: 'expense', icon: 'wallet', hue: 'rose', label: t('quick.expense'), perm: 'expenses.manage', go: () => router.push({ pathname: '/vouchers/new', params: { type: 'EXPENSE' } }) },
    { key: 'product', icon: 'box', hue: 'amber', label: t('quick.newProduct'), perm: 'products.manage', go: () => router.push('/products/form') },
    { key: 'customer', icon: 'users', hue: 'primary', label: t('quick.newCustomer'), perm: 'parties.manage', go: () => router.push({ pathname: '/parties/form', params: { type: 'C' } }) },
    { key: 'statement', icon: 'receipt', hue: 'sky', label: t('quick.statement'), go: () => router.push({ pathname: '/(main)/parties', params: { type: 'C' } }) },
    { key: 'invoices', icon: 'list', hue: 'ink', label: t('quick.invoices'), go: () => router.push('/sales') },
    { key: 'reports', icon: 'chart', hue: 'sky', label: t('quick.reports'), perm: 'reports.view', go: () => router.push('/reports') },
  ].filter((a) => can(a.perm as Permission | undefined)) as Action[];

  return (
    <Sheet visible={open} onClose={hide} title={t('quick.sheetTitle')}>
      {can('sales.create') ? (
        <PressableScale
          testID="quick-sell"
          feedback="tap"
          scaleTo={0.97}
          onPress={nav(() => router.push('/sales/pos'))}
          style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.primary[600] }, shadow.soft]}
        >
          <View style={{ width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' }}>
            <Icon name="scan" size={22} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 17 }}>{t('quick.sell')}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12.5 }}>{t('quick.sellHint')}</Text>
          </View>
          <Icon name="chevron" size={18} color="#FFFFFF" />
        </PressableScale>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {actions.map((a, i) => (
          <Animated.View key={a.key} entering={FadeInDown.delay(30 * i).duration(220)} style={{ width: '31%', flexGrow: 1 }}>
            <PressableScale
              testID={`quick-${a.key}`}
              feedback="tap"
              scaleTo={0.94}
              onPress={nav(a.go)}
              style={{ alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 16, backgroundColor: colors.paper.card, borderWidth: 1, borderColor: colors.paper.line }}
            >
              <IconBadge name={a.icon} hue={a.hue} size={40} />
              <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.ink.DEFAULT, textAlign: 'center' }}>
                {a.label}
              </Text>
            </PressableScale>
          </Animated.View>
        ))}
      </View>
    </Sheet>
  );
}
