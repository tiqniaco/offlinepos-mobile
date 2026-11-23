import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeArabicForSearch, roleHas, formatQty } from '@daftarak/shared';
import { Text, TextField, Icon, IconBadge, colors, fonts, type IconName, type Hue } from '../ui';
import { getDb } from '../db/client';
import { useApp } from '../state/app';
import { searchAll, type SearchResults } from '../domain/search/search';
import { useCurrency } from '../features/inventory/useInvCtx';
import { money } from '../lib/format';

interface Action {
  key: string;
  icon: IconName;
  hue: Hue;
  label: string;
  words: string;
  go: () => void;
  perm?: Parameters<typeof roleHas>[1];
}

/** One search box for the whole app: products, customers, suppliers, invoices, purchases, vouchers, and actions. */
export default function Search() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const user = useApp((s) => s.user)!;
  const currency = useCurrency();
  const [q, setQ] = useState('');
  const [r, setR] = useState<SearchResults | null>(null);
  const fmt = (v: number) => money(v, currency, i18n.language);

  useEffect(() => {
    const h = setTimeout(() => void searchAll(getDb(), q).then(setR), 120);
    return () => clearTimeout(h);
  }, [q]);

  const actions: Action[] = useMemo(
    () => [
      { key: 'sell', icon: 'scan', hue: 'primary', label: t('home.startSale'), words: 'بيع فاتورة كاشير sale', perm: 'sales.create', go: () => router.replace('/(main)/sell') },
      { key: 'collect', icon: 'arrowIn', hue: 'leaf', label: t('quick.collect'), words: 'تحصيل قبض سند receipt', perm: 'parties.manage', go: () => router.replace({ pathname: '/vouchers/new', params: { type: 'RECEIPT' } }) },
      { key: 'purchase', icon: 'cart', hue: 'primary', label: t('quick.purchase'), words: 'شراء مشتريات مورد purchase', perm: 'purchases.manage', go: () => router.replace('/purchases/new') },
      { key: 'expense', icon: 'wallet', hue: 'rose', label: t('quick.expense'), words: 'مصروف مصاريف expense', perm: 'expenses.manage', go: () => router.replace({ pathname: '/vouchers/new', params: { type: 'EXPENSE' } }) },
      { key: 'product', icon: 'box', hue: 'amber', label: t('quick.newProduct'), words: 'منتج صنف جديد product', perm: 'products.manage', go: () => router.replace('/products/form') },
      { key: 'customer', icon: 'users', hue: 'primary', label: t('quick.newCustomer'), words: 'عميل جديد customer', perm: 'parties.manage', go: () => router.replace({ pathname: '/parties/form', params: { type: 'C' } }) },
      { key: 'reports', icon: 'chart', hue: 'sky', label: t('quick.reports'), words: 'تقارير ارباح مبيعات reports', perm: 'reports.view', go: () => router.replace('/reports') },
      { key: 'shift', icon: 'clock', hue: 'ink', label: t('quick.shift'), words: 'وردية خزنة درج shift', go: () => router.replace('/shifts') },
      { key: 'backup', icon: 'upload', hue: 'leaf', label: t('more.backup'), words: 'نسخ احتياطي backup', perm: 'backup.manage', go: () => router.replace('/settings/backup') },
      { key: 'printers', icon: 'printer', hue: 'amber', label: t('more.printers'), words: 'طابعة طباعة printer', go: () => router.replace('/settings/printers') },
      { key: 'offers', icon: 'tag', hue: 'leaf', label: t('more.offers'), words: 'عروض كوبون خصم offers', perm: 'products.manage', go: () => router.replace('/offers') },
      { key: 'appearance', icon: 'image', hue: 'primary', label: t('more.appearance'), words: 'مظهر لون داكن خط اصوات appearance', go: () => router.replace('/settings/appearance') },
    ],
    [t],
  );
  const nq = normalizeArabicForSearch(q);
  const shownActions = actions.filter((a) => (!a.perm || roleHas(user.permissions, a.perm)) && (!nq || normalizeArabicForSearch(`${a.label} ${a.words}`).includes(nq)));

  const Row = ({ icon, hue, title, sub, right, onPress }: { icon: IconName; hue: Hue; title: string; sub?: string; right?: string; onPress: () => void }) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: pressed ? colors.paper.sunk : 'transparent' })}>
      <IconBadge name={icon} hue={hue} size={32} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 21, color: colors.ink.DEFAULT }}>{title}</Text>
        {sub ? <Text variant="caption" numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right ? <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, lineHeight: 20, color: colors.ink.soft }}>{right}</Text> : null}
    </Pressable>
  );
  const Group = ({ title, children, n }: { title: string; children: React.ReactNode; n: number }) =>
    n ? (
      <View style={{ gap: 2 }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 13, lineHeight: 19, color: colors.ink.mute, paddingHorizontal: 12, marginTop: 10 }}>{title}</Text>
        <View style={{ backgroundColor: colors.paper.card, borderRadius: 14, overflow: 'hidden' }}>{children}</View>
      </View>
    ) : null;

  const total = r ? r.products.length + r.customers.length + r.suppliers.length + r.invoices.length + r.purchases.length + r.vouchers.length : 0;
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper.DEFAULT, paddingTop: insets.top + 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 }}>
        <View style={{ flex: 1 }}>
          <TextField testID="global-search" icon="search" placeholder={t('search.placeholder')} value={q} onChangeText={setQ} latinDigits={false} autoFocus returnKeyType="search" />
        </View>
        <Pressable hitSlop={10} onPress={() => router.back()} style={{ padding: 6 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.primary[700] }}>{t('common.cancel')}</Text>
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 4, paddingBottom: insets.bottom + 24 }}>
        <Group title={t('search.actions')} n={shownActions.length}>
          {shownActions.slice(0, nq ? 6 : 12).map((a) => (
            <Row key={a.key} icon={a.icon} hue={a.hue} title={a.label} onPress={a.go} />
          ))}
        </Group>
        {r ? (
          <>
            <Group title={t('tabs.products')} n={r.products.length}>
              {r.products.map((p) => (
                <Row key={p.id} icon="box" hue="amber" title={p.name} sub={`${formatQty(p.qtyMilli)} ${p.unit}`} right={fmt(p.priceMinor)} onPress={() => router.replace({ pathname: '/products/[id]', params: { id: p.id } })} />
              ))}
            </Group>
            <Group title={t('parties.customers')} n={r.customers.length}>
              {r.customers.map((c) => (
                <Row key={c.id} icon="users" hue="primary" title={c.name} sub={c.mobile ? `+${c.mobile}` : undefined} right={c.balanceMinor ? fmt(c.balanceMinor) : undefined} onPress={() => router.replace({ pathname: '/parties/[id]', params: { id: c.id, type: 'C' } })} />
              ))}
            </Group>
            <Group title={t('parties.suppliers')} n={r.suppliers.length}>
              {r.suppliers.map((s) => (
                <Row key={s.id} icon="truck" hue="amber" title={s.name} sub={s.mobile ? `+${s.mobile}` : undefined} right={s.balanceMinor ? fmt(s.balanceMinor) : undefined} onPress={() => router.replace({ pathname: '/parties/[id]', params: { id: s.id, type: 'S' } })} />
              ))}
            </Group>
            <Group title={t('more.invoices')} n={r.invoices.length}>
              {r.invoices.map((d) => (
                <Row key={d.id} icon="receipt" hue={d.type === 'RETURN' ? 'rose' : 'sky'} title={`${d.number ?? ''}${d.status === 'VOIDED' ? ` · ${t('invoice.voided')}` : ''}`} sub={d.name ?? undefined} right={fmt(d.totalMinor)} onPress={() => router.replace({ pathname: '/sales/[id]', params: { id: d.id } })} />
              ))}
            </Group>
            <Group title={t('purchase.listTitle')} n={r.purchases.length}>
              {r.purchases.map((d) => (
                <Row key={d.id} icon="cart" hue="primary" title={d.number ?? ''} sub={d.name ?? undefined} right={fmt(d.totalMinor)} onPress={() => router.replace({ pathname: '/purchases/[id]', params: { id: d.id } })} />
              ))}
            </Group>
            <Group title={t('voucher.listTitle')} n={r.vouchers.length}>
              {r.vouchers.map((v) => (
                <Row key={v.id} icon="wallet" hue="leaf" title={`${t(`voucher.title.${v.type}`)} ${v.number}`} sub={v.name ?? undefined} right={fmt(v.amountMinor)} onPress={() => router.replace({ pathname: '/vouchers/[id]', params: { id: v.id } })} />
              ))}
            </Group>
            {q.trim() && total === 0 && !shownActions.length ? (
              <View style={{ alignItems: 'center', paddingTop: 40, gap: 6 }}>
                <Icon name="search" size={30} color={colors.ink.faint} />
                <Text variant="body">{t('search.nothing', { q })}</Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
