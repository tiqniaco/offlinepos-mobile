import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { addDays, businessDay, formatMinor, roleHas } from '@daftarak/shared';
import { Screen, Text, Icon, Card, SectionTitle, EmptyState, colors, fonts, shadow } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { deleteParty, getParty, owed, PartyError } from '../../domain/parties/parties';
import { partyDue, partyStatement, type StatementRow } from '../../domain/parties/statement';
import { ActionTiles, type Tile } from '../../features/common/ActionTiles';
import { balanceLabel, reminderText } from '../../features/parties/format';
import { callPhone, openWhatsApp } from '../../features/export/whatsapp';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCart } from '../../state/cart';
import { dayText } from '../../features/export/builders';
import { money } from '../../lib/format';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

type Party = NonNullable<Awaited<ReturnType<typeof getParty>>>;

/** Customer / supplier card: balance, one-tap actions (collect, sell, statement, WhatsApp, call), last movements. */
export default function PartyDetail() {
  const { t, i18n } = useTranslation();
  const { id, type: tp } = useLocalSearchParams<{ id: string; type?: string }>();
  const type: 'C' | 'S' = tp === 'S' ? 'S' : 'C';
  const currency = useCurrency();
  const ctx = useBizCtx();
  const user = useApp((s) => s.user)!;
  const business = useApp((s) => s.business);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const template = useApp((s) => s.settings.reminderTemplate) || t('parties.reminderDefault');
  const reminderDays = useApp((s) => s.settings.reminderDays ?? 30);
  const [p, setP] = useState<Party | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [recent, setRecent] = useState<StatementRow[]>([]);
  const [late, setLate] = useState<number | null>(null);
  const can = (perm: Parameters<typeof roleHas>[1]) => roleHas(user.permissions, perm);

  useFocusEffect(
    useCallback(() => {
      const db = getDb();
      const today = businessDay(Date.now(), tz);
      void getParty(db, type, id)
        .then(setP)
        .catch(() => setP(null))
        .finally(() => setLoaded(true));
      void partyStatement(db, type, id, addDays(today, -90), today)
        .then((s) => setRecent(s.rows.slice(-12).reverse()))
        .catch(() => undefined);
      // Secondary info after the transition: one query for this customer only.
      const h = setTimeout(() => {
        if (type === 'C')
          void partyDue(db, id, today)
            .then((d) => setLate(d && d.days >= reminderDays ? d.days : null))
            .catch(() => undefined);
      }, 220);
      return () => clearTimeout(h);
    }, [id, type, tz, reminderDays]),
  );

  if (!p)
    return (
      <Screen back>
        {loaded ? <EmptyState icon="users" hue="sky" title={t('common.notFound')} /> : <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 32 }} />}
      </Screen>
    );
  const o = owed(type, p.balanceMinor);
  const b = balanceLabel(type, o, currency, i18n.language);
  const cur = currency === 'SAR' ? 'ر.س' : 'ج.م';
  const overLimit = type === 'C' && p.creditLimitMinor && o > p.creditLimitMinor;

  const tiles: Tile[] = [
    ...(type === 'C' && can('parties.manage') ? [{ key: 'receipt', icon: 'arrowIn' as const, hue: 'leaf' as const, label: t('parties.collect'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'RECEIPT', partyId: id } }) }] : []),
    ...(type === 'S' && can('purchases.manage') ? [{ key: 'pay', icon: 'arrowOut' as const, hue: 'amber' as const, label: t('parties.pay'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'PAYMENT', partyId: id } }) }] : []),
    ...(type === 'C' && can('sales.create')
      ? [{ key: 'sell', icon: 'scan' as const, hue: 'primary' as const, label: t('parties.sell'), onPress: () => { useCart.getState().setCustomer(p.id, p.name, p.priceTier ?? 'retail'); router.push('/sales/pos'); } }]
      : []),
    ...(type === 'C' && can('parties.manage') ? [{ key: 'crefund', icon: 'arrowOut' as const, hue: 'amber' as const, label: t('voucher.title.CUSTOMER_REFUND'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'CUSTOMER_REFUND', partyId: id } }) }] : []),
    ...(type === 'S' && can('purchases.manage') ? [{ key: 'srefund', icon: 'arrowIn' as const, hue: 'leaf' as const, label: t('voucher.title.SUPPLIER_REFUND'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'SUPPLIER_REFUND', partyId: id } }) }] : []),
    ...(type === 'S' && can('purchases.manage') ? [{ key: 'buy', icon: 'cart' as const, hue: 'primary' as const, label: t('parties.buy'), onPress: () => router.push({ pathname: '/purchases/new', params: { supplierId: id } }) }] : []),
    { key: 'statement', icon: 'receipt', hue: 'sky', label: t('parties.statement'), onPress: () => router.push({ pathname: '/parties/statement', params: { id, type } }) },
    ...(p.mobile ? [{ key: 'wa', icon: 'whatsapp' as const, hue: 'leaf' as const, label: t('share.whatsapp'), onPress: () => void openWhatsApp(p.mobile, '') }] : []),
    ...(p.mobile ? [{ key: 'call', icon: 'phone' as const, hue: 'ink' as const, label: t('parties.call'), onPress: () => void callPhone(p.mobile) }] : []),
  ];

  const remind = () =>
    void openWhatsApp(p.mobile, reminderText(template, { name: p.name, amount: `${formatMinor(o)} ${cur}`, business: business?.name ?? '', days: late ?? 0 }));

  const del = () =>
    Alert.alert(t('parties.delete'), t('parties.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'),
        style: 'destructive',
        onPress: async () => {
          if (!ctx) return;
          try {
            await deleteParty(ctx, type, id);
            router.back();
          } catch (e) {
            toast(e instanceof PartyError ? t(`parties.errors.${e.code}`) : errorMessage(t, e), 'error');
          }
        },
      },
    ]);

  return (
    <Screen
      back
      right={
        can(type === 'C' ? 'parties.manage' : 'purchases.manage') ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable hitSlop={8} onPress={() => router.push({ pathname: '/parties/form', params: { id, type } })} style={[{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper.card }, shadow.soft]}>
              <Icon name="edit" size={18} color={colors.ink.DEFAULT} />
            </Pressable>
            <Pressable hitSlop={8} onPress={del} style={[{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper.card }, shadow.soft]}>
              <Icon name="trash" size={18} color={colors.rose[600]} />
            </Pressable>
          </View>
        ) : undefined
      }
    >
      <View style={[{ borderRadius: 20, overflow: 'hidden' }, shadow.lifted]}>
        <LinearGradient colors={colors.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 16, gap: 2 }}>
          <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 21, lineHeight: 30 }}>{p.name}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.medium, fontSize: 13, lineHeight: 20 }}>
            {[p.mobile ? `+${p.mobile}` : null, p.address].filter(Boolean).join('  ·  ') || t(type === 'C' ? 'parties.customer' : 'parties.supplier')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.medium, fontSize: 13, lineHeight: 22 }}>{o ? b.tag : t('parties.settled')}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 30, lineHeight: 49 }}>{money(Math.abs(o), currency, i18n.language)}</Text>
            </View>
            {type === 'C' && p.creditLimitMinor ? <Text numberOfLines={2} style={{ flexShrink: 1, color: 'rgba(255,255,255,0.85)', fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 21 }}>{t('parties.limitIs', { amount: money(p.creditLimitMinor, currency, i18n.language) })}</Text> : null}
          </View>
        </LinearGradient>
      </View>

      {overLimit ? (
        <Card style={{ backgroundColor: colors.rose[50] }}>
          <Text style={{ color: colors.rose[700], fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 }}>{t('parties.overLimit')}</Text>
        </Card>
      ) : null}
      {type === 'C' && o > 0 && p.mobile ? (
        <Pressable onPress={remind} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.leaf[50], opacity: pressed ? 0.85 : 1 }]}>
          <Icon name="bell" size={20} color={colors.leaf[700]} />
          <Text style={{ flex: 1, color: colors.leaf[700], fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 }}>{late != null ? t('parties.remindLate', { n: late }) : t('parties.remind')}</Text>
          <Icon name="whatsapp" size={20} color={colors.leaf[700]} />
        </Pressable>
      ) : null}

      <ActionTiles tiles={tiles} columns={4} />

      <SectionTitle>{t('parties.recent')}</SectionTitle>
      {recent.length === 0 ? (
        <EmptyState icon="receipt" hue="sky" title={t('parties.noMovements')} />
      ) : (
        <Card padded={false}>
          {recent.map((r, i) => (
            <Pressable
              key={r.key}
              onPress={() => {
                if (r.kind === 'invoice' || r.kind === 'return') router.push({ pathname: '/sales/[id]', params: { id: r.docId } });
                else if (r.kind === 'purchase' || r.kind === 'purchase_return') router.push({ pathname: '/purchases/[id]', params: { id: r.docId } });
                else if (r.kind !== 'void') router.push({ pathname: '/vouchers/[id]', params: { id: r.docId } });
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line, backgroundColor: pressed ? colors.paper.sunk : 'transparent' })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 21, color: colors.ink.DEFAULT }}>
                  {t(`report.kind.${r.kind}`)} {r.number ?? ''}
                </Text>
                <Text variant="caption">{dayText(r.day)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 14.5, lineHeight: 21, color: r.debitMinor - r.creditMinor > 0 === (type === 'C') ? colors.rose[700] : colors.leaf[700] }}>
                  {money(r.debitMinor && r.creditMinor ? r.docTotalMinor ?? r.debitMinor : r.debitMinor || r.creditMinor, currency, i18n.language)}
                </Text>
                <Text variant="caption">{t('report.balance')} {formatMinor(r.balanceMinor)}</Text>
              </View>
            </Pressable>
          ))}
        </Card>
      )}
    </Screen>
  );
}
