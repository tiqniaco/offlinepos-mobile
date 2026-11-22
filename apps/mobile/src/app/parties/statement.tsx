import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, formatMinor, formatQty } from '@daftarak/shared';
import { Screen, Text, Card, EmptyState, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { partyStatement, type Statement } from '../../domain/parties/statement';
import { Segmented } from '../../features/common/Segmented';
import { DateRangeBar, presetRange, type RangeKey } from '../../features/common/DateRange';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader, dayText, statementDoc, balanceWords } from '../../features/export/builders';
import { useCurrency } from '../../features/inventory/useInvCtx';

/** كشف حساب: any range, opening balance, detailed (with items) or summary; WhatsApp / PDF / Excel / print. */
export default function StatementScreen() {
  const { t } = useTranslation();
  const { id, type: tp } = useLocalSearchParams<{ id: string; type?: string }>();
  const type: 'C' | 'S' = tp === 'S' ? 'S' : 'C';
  const currency = useCurrency();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [range, setRange] = useState<{ key: RangeKey; from: number; to: number }>(() => {
    const [from, to] = presetRange('month', today);
    return { key: 'month', from, to };
  });
  const [detailed, setDetailed] = useState<'summary' | 'detailed'>('summary');
  const [st, setSt] = useState<Statement | null>(null);

  useEffect(() => {
    void partyStatement(getDb(), type, id, range.from, range.to, { detailed: detailed === 'detailed' }).then(setSt);
  }, [id, type, range.from, range.to, detailed]);

  const build = useMemo(() => async () => statementDoc(st!, await bizHeader(), detailed === 'detailed'), [st, detailed]);

  return (
    <Screen back title={t(type === 'C' ? 'report.statementC' : 'report.statementS')} subtitle={st?.party.name}>
      <DateRangeBar value={range} today={today} onChange={setRange} />
      <Segmented value={detailed} onChange={setDetailed} options={[{ value: 'summary', label: t('statement.summary') }, { value: 'detailed', label: t('statement.detailed') }]} />
      {st ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Card style={{ flex: 1 }}>
              <Text variant="caption">{t('report.opening')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{balanceWords(type, st.openingMinor, currency)}</Text>
            </Card>
            <Card style={{ flex: 1, backgroundColor: colors.primary[50] }}>
              <Text variant="caption">{t('report.closing')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.primary[800] }}>{balanceWords(type, st.closingMinor, currency)}</Text>
            </Card>
          </View>
          <ExportBar build={build} mobile={st.party.mobile} />
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
                        {t(`report.kind.${r.kind}`)} {r.number ?? ''}
                      </Text>
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
      ) : null}
    </Screen>
  );
}
