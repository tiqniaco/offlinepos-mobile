import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay } from '@daftarak/shared';
import { Screen, Text, Card, EmptyState, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { partyStatement, type Statement } from '../../domain/parties/statement';
import { Segmented } from '../../features/common/Segmented';
import { DateRangeBar, presetRange, type RangeKey } from '../../features/common/DateRange';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader, statementDoc, balanceWords } from '../../features/export/builders';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { StatementTable } from '../../features/parties/StatementTable';

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
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>('loading');

  useEffect(() => {
    let live = true;
    setState('loading');
    partyStatement(getDb(), type, id, range.from, range.to, { detailed: detailed === 'detailed' })
      .then((x) => {
        if (!live) return;
        setSt(x);
        setState(x ? 'ok' : 'missing');
      })
      .catch(() => {
        if (!live) return;
        setSt(null);
        setState('missing');
      });
    return () => {
      live = false;
    };
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
          <StatementTable st={st} />
        </>
      ) : state === 'missing' ? (
        <EmptyState icon="receipt" hue="sky" title={t('common.notFound')} />
      ) : (
        <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 24 }} />
      )}
    </Screen>
  );
}
