import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, Card, Chip, EmptyState, colors, fonts, shadow } from '../../ui';
import { getDb } from '../../db/client';
import { getCountReport, type CountReportLine, type CountSummary } from '../../domain/inventory/counts';
import { useCan, useCurrency } from '../../features/inventory/useInvCtx';
import { countDoc, countScope, countTitle, type CountFilter } from '../../features/inventory/countDoc';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader } from '../../features/export/builders';
import { dateTimeLabel, money, qty } from '../../lib/format';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';

const FILTERS: CountFilter[] = ['all', 'short', 'surplus', 'match'];

/** One count: expected vs counted per product, biggest money impact first; filters عجز / زيادة / مطابق; export. */
export default function CountReport() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useCurrency();
  const costView = useCan('cost.view');
  const canCount = useCan('stock.adjust');
  const [data, setData] = useState<{ count: CountSummary; lines: CountReportLine[] } | null | undefined>(undefined);
  const [filter, setFilter] = useState<CountFilter>('all');
  useFocusEffect(
    useCallback(() => {
      void getCountReport(getDb(), id).then(setData, (e) => {
        setData(null);
        toast(errorMessage(t, e), 'error');
      });
    }, [id, t]),
  );
  const shown = useMemo(() => (data ? (filter === 'all' ? data.lines : data.lines.filter((l) => l.kind === filter)) : []), [data, filter]);
  const m = (v: number) => money(v, currency, i18n.language);
  if (data === undefined) return <Screen back title={t('countReport.title')}>{null}</Screen>;
  if (data === null)
    return (
      <Screen back title={t('countReport.title')}>
        <EmptyState icon="clipboard" hue="sky" title={t('countReport.notFound')} />
      </Screen>
    );
  const c = data.count;
  const n = (k: CountFilter) => (k === 'all' ? data.lines.length : data.lines.filter((l) => l.kind === k).length);
  const tile = (label: string, value: string, color: string, bg: string) => (
    <View style={{ flexBasis: '47%', flexGrow: 1, padding: 12, borderRadius: 14, backgroundColor: bg, gap: 2 }}>
      <Text style={{ fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 18, color }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color }}>{value}</Text>
    </View>
  );
  return (
    <Screen
      back
      title={countTitle(c)}
      subtitle={`${t(`countReport.status.${c.status}`)}${c.number ? `  ·  ${c.number}` : ''}`}
      footer={c.status === 'DRAFT' && canCount ? <Button testID="count-resume" icon="scan" title={t('countFlow.resume')} onPress={() => router.replace('/products/count')} /> : undefined}
    >
      <Card>
        <View style={{ gap: 4 }}>
          <Text variant="caption">
            {dateTimeLabel(i18n.language, c.postedAt ?? c.updatedAt)}
            {c.userName ? `  ·  ${c.userName}` : ''}
          </Text>
          <Text variant="subtitle">{countScope(c)}</Text>
          {c.status === 'DISCARDED' ? <Text variant="caption">{t('countReport.discardedHint')}</Text> : null}
          {c.status === 'DRAFT' ? <Text variant="caption">{t('countReport.draftHint')}</Text> : null}
        </View>
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tile(t('countReport.shortTitle', { n: c.shortItems }), costView ? m(c.shortageMinor) : String(c.shortItems), colors.rose[700], colors.rose[50])}
        {tile(t('countReport.surplusTitle', { n: c.surplusItems }), costView ? m(c.surplusMinor) : String(c.surplusItems), colors.sky[700], colors.sky[50])}
        {costView ? tile(t('countReport.net'), m(c.netMinor), c.netMinor < 0 ? colors.rose[700] : colors.leaf[700], colors.paper.card) : null}
        {tile(t('countReport.items'), String(c.items), colors.ink.DEFAULT, colors.paper.card)}
      </View>
      <ExportBar build={async () => countDoc(c, data.lines, await bizHeader(), { filter, showValue: costView })} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {FILTERS.map((f) => (
          <Chip key={f} testID={`count-filter-${f}`} label={t(`countReport.filter.${f}`)} count={n(f)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>
      {shown.length === 0 ? <EmptyState icon="check" hue="leaf" title={t('countReport.noneInFilter')} /> : null}
      {shown.map((l) => {
        const tone = l.kind === 'short' ? colors.rose[700] : l.kind === 'surplus' ? colors.sky[700] : colors.leaf[700];
        return (
          <View key={l.productId} style={[{ padding: 12, gap: 6, borderRadius: 16, backgroundColor: colors.paper.card }, shadow.soft]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>
                {l.name}
                {l.variantLabel ? ` · ${l.variantLabel}` : ''}
              </Text>
              {costView && l.valueMinor ? <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: tone }}>{l.valueMinor > 0 ? '+' : ''}{m(l.valueMinor)}</Text> : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Text variant="caption" style={{ flex: 1 }}>{t('countReport.col.expected')}: {qty(l.expectedMilli)} {l.unitName}</Text>
              <Text variant="caption" style={{ flex: 1 }}>{t('countReport.col.counted')}: {qty(l.countedMilli)}</Text>
              <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 12.5, lineHeight: 18, color: tone }}>{l.kind === 'match' ? `✓ ${t('countReport.match')}` : `${l.diffMilli > 0 ? '+' : ''}${qty(l.diffMilli)}`}</Text>
            </View>
          </View>
        );
      })}
    </Screen>
  );
}
