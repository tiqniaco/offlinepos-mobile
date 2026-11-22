import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatMinor, formatQty } from '@daftarak/shared';
import { Text, Card, EmptyState, colors, fonts } from '../../ui';
import type { Statement } from '../../domain/parties/statement';
import { dayText } from '../export/builders';

/** Statement table (pure; used by the statement screen and the dev gallery). */
export function StatementTable({ st }: { st: Statement }) {
  const { t } = useTranslation();
  return (
    <>
      {st.rows.length === 0 ? (
        <EmptyState icon="receipt" hue="sky" title={t('statement.empty')} />
      ) : (
        <Card padded={false}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.primary[600], borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
            <Text style={{ flex: 1, color: '#FFF', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 }}>{t('report.desc')}</Text>
            <Text style={{ width: 74, color: '#FFF', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>{t('report.debit')}</Text>
            <Text style={{ width: 74, color: '#FFF', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>{t('report.credit')}</Text>
            <Text style={{ width: 78, color: '#FFF', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, textAlign: 'center' }}>{t('report.balance')}</Text>
          </View>
          {st.rows.map((r, i) => (
            <View key={r.key} style={{ paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line, backgroundColor: i % 2 ? colors.paper.DEFAULT : colors.paper.card }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 19, color: colors.ink.DEFAULT }}>
                {t(`report.kind.${r.kind}`)}
              </Text>
              {r.number ? <Text variant="caption" style={{ writingDirection: 'ltr', textAlign: 'right' }}>{r.number}</Text> : null}
              <Text variant="caption">{dayText(r.day)}</Text>
            </View>
            <Text style={{ width: 74, textAlign: 'center', fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.ink.soft }}>{r.debitMinor ? formatMinor(r.debitMinor) : '—'}</Text>
            <Text style={{ width: 74, textAlign: 'center', fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colors.ink.soft }}>{r.creditMinor ? formatMinor(r.creditMinor) : '—'}</Text>
            <Text style={{ width: 78, textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink.DEFAULT }}>{formatMinor(r.balanceMinor)}</Text>
              </View>
              {r.items?.map((it, j) => (
            <Text key={j} variant="caption" style={{ marginStart: 8 }}>
              • {it.name} — {formatQty(it.qtyMilli)} {it.unit} × {formatMinor(it.priceMinor)} = {formatMinor(it.totalMinor)}
            </Text>
              ))}
            </View>
          ))}
          <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 2, borderTopColor: colors.ink.DEFAULT }}>
            <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 13.5, lineHeight: 19, color: colors.ink.DEFAULT }}>{t('report.total')}</Text>
            <Text style={{ width: 74, textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink.DEFAULT }}>{formatMinor(st.totalDebitMinor)}</Text>
            <Text style={{ width: 74, textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.ink.DEFAULT }}>{formatMinor(st.totalCreditMinor)}</Text>
            <Text style={{ width: 78, textAlign: 'center', fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: colors.primary[700] }}>{formatMinor(st.closingMinor)}</Text>
          </View>
        </Card>
      )}
    </>
  );
}
