/** Dashboard + report list (pure view; container app/reports/index.tsx). */
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, SectionTitle, ListGroup, ListRow, colors, fonts } from '../../ui';
import type { Dashboard } from '../../domain/reports/reports';
import { money, qty } from '../../lib/format';
import { dayText } from '../export/builders';
import { Bars } from './Bars';
import type { ReportDef } from './defs';
import { AdBanner } from '../ads/AdBanner';
import { maskMoney } from '../../state/privacy';

export function DashboardView({ d, currency, lang, showProfit, reports, locked, onOpen, tip, masked = false, right }: { tip?: React.ReactNode; masked?: boolean; right?: React.ReactNode; d: Dashboard | null; currency: 'EGP' | 'SAR'; lang: string; showProfit: boolean; reports: ReportDef[]; locked: (r: ReportDef) => boolean; onOpen: (r: ReportDef) => void }) {
  const { t } = useTranslation();
  const fmt = (v: number) => maskMoney(money(v, currency, lang), masked);
  const group = (g: ReportDef['group']) => reports.filter((r) => r.group === g);
  const tile = (label: string, value: string, color: string = colors.ink.DEFAULT) => (
    <Card style={{ flexGrow: 1, minWidth: '45%' }}>
      <Text variant="caption">{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color }}>{value}</Text>
    </Card>
  );
  return (
    <Screen back title={t('reports.title')} right={right}>
      {tip}
      {d ? (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {tile(t('reports.today', { n: d.todayInvoices }), fmt(d.todaySalesMinor), colors.primary[700])}
            {showProfit ? tile(t('reports.todayProfit'), fmt(d.todayProfitMinor), colors.leaf[700]) : null}
            {tile(t('reports.month'), fmt(d.monthSalesMinor))}
            {showProfit ? tile(t('reports.monthProfit'), fmt(d.monthProfitMinor), colors.leaf[700]) : null}
            {tile(t('reports.receivables'), fmt(d.receivablesMinor), colors.rose[700])}
            {tile(t('reports.payables'), fmt(d.payablesMinor), colors.amber[700])}
          </View>
          <Card>
            <Text variant="subtitle">{t('reports.last30')}</Text>
            <View style={{ height: 8 }} />
            <Bars values={d.last30.map((x) => x.salesMinor)} labels={[dayText(d.last30[0]!.day).slice(5), dayText(d.last30[29]!.day).slice(5)]} />
          </Card>
          {d.topItems.length ? (
            <Card>
              <Text variant="subtitle">{t('reports.topItems')}</Text>
              {d.topItems.map((x, i) => (
                <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>{i + 1}. {x.name} <Text variant="caption">({qty(x.qtyMilli)})</Text></Text>
                  <Text variant="label" style={{ color: colors.ink.DEFAULT }}>{fmt(x.salesMinor)}</Text>
                </View>
              ))}
            </Card>
          ) : null}
          <Text variant="caption">{t('reports.lowStockLine', { n: d.lowStock })}  ·  {t('reports.stockValueLine', { v: fmt(d.stockValueMinor) })}</Text>
        </>
      ) : null}
      {(['sales', 'money', 'stock'] as const).map((g) =>
        group(g).length ? (
          <View key={g} style={{ gap: 8 }}>
            <SectionTitle>{t(`reports.groups.${g}`)}</SectionTitle>
            <ListGroup>
              {group(g).map((r, i, a) => (
                <ListRow key={r.id} testID={`report-${r.id}`} icon={r.icon} hue={locked(r) ? 'ink' : r.hue} title={t(`reports.names.${r.id}`)} value={locked(r) ? t('reports.pro') : undefined} onPress={() => onOpen(r)} last={i === a.length - 1} />
              ))}
            </ListGroup>
          </View>
        ) : null,
      )}
      <AdBanner place="reports" />
    </Screen>
  );
}
