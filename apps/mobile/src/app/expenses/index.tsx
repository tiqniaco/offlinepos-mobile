import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay } from '@daftarak/shared';
import { Screen, Text, Card, EmptyState, Fab, Button, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { expenseTotals, listVouchers } from '../../domain/vouchers/vouchers';
import { hasFeature } from '../../domain/licence/guard';
import { DateRangeBar, presetRange, type RangeKey } from '../../features/common/DateRange';
import { DocRow } from '../../features/common/DocRow';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader, expensesDoc, dayText } from '../../features/export/builders';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { AdBanner } from '../../features/ads/AdBanner';
import { money } from '../../lib/format';

/** Expenses by period with totals per category; add in two taps. */
export default function Expenses() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [range, setRange] = useState<{ key: RangeKey; from: number; to: number }>(() => {
    const [from, to] = presetRange('month', today);
    return { key: 'month', from, to };
  });
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listVouchers>>>([]);
  const [totals, setTotals] = useState<Awaited<ReturnType<typeof expenseTotals>>>([]);
  useFocusEffect(
    useCallback(() => {
      const db = getDb();
      void listVouchers(db, { types: ['EXPENSE'], from: range.from, to: range.to, limit: 500 }).then(setRows);
      void expenseTotals(db, range.from, range.to).then(setTotals);
    }, [range.from, range.to]),
  );
  const total = useMemo(() => totals.reduce((s, x) => s + Number(x.total), 0), [totals]);
  const locked = !hasFeature('expenses_shifts');
  return (
    <View style={{ flex: 1 }}>
      <Screen back title={t('expenses.title')} right={<Button compact kind="secondary" icon="tag" title={t('expenses.categories')} onPress={() => router.push('/expenses/categories')} />}>
        {locked ? (
          <Card style={{ backgroundColor: colors.amber[50] }}>
            <Text style={{ color: colors.amber[700], fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 }}>{t('licence.feature')}</Text>
            <Button compact kind="secondary" title={t('more.subscription')} onPress={() => router.push('/settings/subscription')} />
          </Card>
        ) : null}
        <DateRangeBar value={range} today={today} onChange={setRange} presets={['today', 'week', 'month', 'lastMonth', 'year', 'custom']} />
        <Card>
          <Text variant="caption">{t('expenses.total')}</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 24, lineHeight: 34, color: colors.rose[700] }}>{money(total, currency, i18n.language)}</Text>
          {totals.map((x) => (
            <View key={x.categoryId ?? 'x'} style={{ marginTop: 6, gap: 3 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text variant="label">{x.name}</Text>
                <Text variant="label">{money(Number(x.total), currency, i18n.language)}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.paper.sunk }}>
                <View style={{ width: `${total ? (Number(x.total) / total) * 100 : 0}%`, height: 6, borderRadius: 3, backgroundColor: colors.primary[500] }} />
              </View>
            </View>
          ))}
        </Card>
        <ExportBar build={async () => expensesDoc(rows, totals, range.from, range.to, await bizHeader())} kinds={['pdf', 'excel', 'print', 'whatsapp']} />
        {rows.length === 0 ? <EmptyState icon="wallet" hue="rose" title={t('expenses.empty')} body={t('expenses.emptyBody')} /> : null}
        {rows.map((r) => (
          <DocRow
            key={r.id}
            icon="wallet"
            hue="rose"
            title={r.categoryName ?? ''}
            subtitle={`${dayText(r.businessDay)}${r.note ? ` · ${r.note}` : ''}`}
            amount={money(r.amountMinor, currency, i18n.language)}
            tag={r.status === 'VOIDED' ? t('invoice.voided') : t(`pay.methods.${r.method}`)}
            voided={r.status === 'VOIDED'}
            onPress={() => router.push({ pathname: '/vouchers/[id]', params: { id: r.id } })}
          />
        ))}
        <View style={{ height: 70 }} />
      </Screen>
      <AdBanner place="expenses" />
      {!locked ? <Fab testID="expense-add" onPress={() => router.push({ pathname: '/vouchers/new', params: { type: 'EXPENSE' } })} /> : null}
    </View>
  );
}
