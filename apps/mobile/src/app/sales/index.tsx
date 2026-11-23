import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay } from '@daftarak/shared';
import { Screen, Text, TextField, EmptyState, Card, colors, fonts, shadow } from '../../ui';
import { getDb } from '../../db/client';
import { listSales, todaySummary } from '../../domain/sales/sales';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { useApp } from '../../state/app';
import { money, dateTimeLabel } from '../../lib/format';

type Row = Awaited<ReturnType<typeof listSales>>[number];

export default function SalesList() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [today, setToday] = useState<Awaited<ReturnType<typeof todaySummary>> | null>(null);
  const done = useRef(false);
  const load = useCallback(async () => {
    const r = await listSales(getDb(), { search: q, limit: 40 });
    done.current = r.length < 40;
    setRows(r);
    setToday(await todaySummary(getDb(), businessDay(Date.now(), tz)));
  }, [q, tz]);
  useEffect(() => {
    const h = setTimeout(() => void load(), 200);
    return () => clearTimeout(h);
  }, [load]);
  useFocusEffect(useCallback(() => void load(), [load]));
  const more = async () => {
    if (done.current || !rows.length) return;
    const last = rows[rows.length - 1]!;
    const r = await listSales(getDb(), { search: q, before: { postedAt: last.postedAt!, id: last.id } });
    done.current = r.length < 40;
    setRows((x) => [...x, ...r]);
  };
  return (
    <Screen back title={t('more.invoices')} scroll={false}>
      {today ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text variant="caption">{t('invoice.today')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 30, color: colors.ink.DEFAULT }}>{money(today.salesMinor - today.returnsMinor, currency, i18n.language)}</Text>
            </View>
            <Text variant="caption">{t('home.todayInvoices', { n: today.invoices })}</Text>
          </View>
        </Card>
      ) : null}
      <View style={{ height: 12 }} />
      <TextField icon="search" placeholder={t('invoice.search')} value={q} onChangeText={setQ} />
      <View style={{ flex: 1, marginTop: 12 }}>
        {rows.length === 0 ? (
          <EmptyState icon="card" title={t('invoice.empty')} />
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(r) => r.id}
            onEndReached={() => void more()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push({ pathname: '/sales/[id]', params: { id: item.id } })} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: item.status === 'VOIDED' ? colors.ink.faint : colors.ink.DEFAULT, textDecorationLine: item.status === 'VOIDED' ? 'line-through' : 'none' }}>
                    {item.number}
                    {item.customerName ? `  ·  ${item.customerName}` : ''}
                  </Text>
                  <Text variant="caption">{item.postedAt ? dateTimeLabel(i18n.language, item.postedAt) : ''}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: item.type === 'RETURN' ? colors.rose[700] : colors.ink.DEFAULT }}>
                    {item.type === 'RETURN' ? '−' : ''}
                    {money(item.totalMinor, currency, i18n.language)}
                  </Text>
                  {item.status === 'VOIDED' ? <Text style={{ color: colors.rose[700], fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 }}>{t('invoice.voided')}</Text> : item.type === 'RETURN' ? <Text style={{ color: colors.rose[700], fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 }}>{t('invoice.return')}</Text> : item.creditMinor > 0 ? <Text style={{ color: colors.amber[700], fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18 }}>{t('invoice.credit')}</Text> : null}
                </View>
              </Pressable>
            )}
          />
        )}
      </View>
    </Screen>
  );
}
