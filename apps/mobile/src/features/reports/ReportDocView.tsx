/** In-app rendering of a ReportDoc (same model as the PDF / Excel / thermal outputs). */
import { useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, Card, EmptyState, colors, fonts } from '../../ui';
import type { ReportDoc } from '../export/report';

/** Rows drawn on screen (plain views, not virtualised); the rest is in the exported PDF / Excel file. */
const MAX_ROWS = 100;

export function ReportDocView({ d }: { d: ReportDoc }) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const cols = d.columns.filter((c) => width >= 520 || !c.wideOnly);
  const numW = cols.length > 4 ? 66 : 82;
  return (
    <View style={{ gap: 10 }}>
      {d.summary.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {d.summary.map((s) => (
            <Card key={s.label} style={{ flexGrow: 1, minWidth: '45%', backgroundColor: s.strong ? colors.primary[50] : colors.paper.card }}>
              <Text variant="caption">{s.label}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: s.strong ? colors.primary[800] : colors.ink.DEFAULT }}>{s.value}</Text>
            </Card>
          ))}
        </View>
      ) : null}
      {cols.length && d.rows.length === 0 ? <EmptyState icon="chart" hue="sky" title={t('reports.empty')} /> : null}
      {cols.length && d.rows.length ? (
        <Card padded={false}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.primary[600], borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            {cols.map((c) => (
              <Text key={c.key} numberOfLines={1} style={{ ...(c.num ? { width: numW, textAlign: 'center' as const } : { flex: 1 }), color: '#FFF', fontFamily: fonts.bold, fontSize: 12.5, lineHeight: 18 }}>
                {c.label}
              </Text>
            ))}
          </View>
          {d.rows.slice(0, MAX_ROWS).map((r, i) => (
            <View key={i} style={{ paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line, backgroundColor: i % 2 ? colors.paper.DEFAULT : colors.paper.card, opacity: r.muted ? 0.55 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {cols.map((c) => (
                  <Text key={c.key} numberOfLines={c.num ? 1 : 2} style={{ ...(c.num ? { width: numW, textAlign: 'center' as const } : { flex: 1 }), fontFamily: c.num ? fonts.medium : fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.ink.DEFAULT }}>
                    {r.cells[c.key] ?? ''}
                  </Text>
                ))}
              </View>
              {r.sub?.map((s, j) => (
                <Text key={j} variant="caption">• {s}</Text>
              ))}
            </View>
          ))}
          {d.rows.length > MAX_ROWS ? <Text variant="caption" style={{ padding: 10 }}>{t('reports.moreInFile', { n: d.rows.length - MAX_ROWS })}</Text> : null}
        </Card>
      ) : null}
      {d.totals.length ? (
        <Card>
          {d.totals.map((x) => (
            <View key={x.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderTopWidth: x.strong ? 1 : 0, borderTopColor: colors.paper.line }}>
              <Text style={{ fontFamily: x.strong ? fonts.bold : fonts.medium, fontSize: 14, lineHeight: 21, color: colors.ink.DEFAULT }}>{x.label}</Text>
              <Text style={{ fontFamily: x.strong ? fonts.bold : fonts.medium, fontSize: 14, lineHeight: 21, color: x.strong ? colors.primary[700] : colors.ink.DEFAULT }}>{x.value}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}
