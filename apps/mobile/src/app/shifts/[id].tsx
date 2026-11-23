import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, EmptyState, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { getShift, shiftSummary, type ShiftSummary } from '../../domain/shifts/shifts';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader, shiftDoc } from '../../features/export/builders';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, dateTimeLabel } from '../../lib/format';

type S = NonNullable<Awaited<ReturnType<typeof getShift>>>;

/** Closed shift report (Z report): share with the owner on WhatsApp, print, PDF. */
export default function ShiftReport() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useCurrency();
  const [s, setS] = useState<S | null>(null);
  const [sum, setSum] = useState<ShiftSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const load = async () => {
      const x = await getShift(getDb(), id);
      setS(x);
      if (!x) return;
      setSum(x.summaryJson ? (JSON.parse(x.summaryJson) as ShiftSummary) : await shiftSummary(getDb(), id));
    };
    void load()
      .catch(() => setS(null))
      .finally(() => setLoaded(true));
  }, [id]);
  if (!s || !sum)
    return (
      <Screen back>
        {loaded ? <EmptyState icon="clock" hue="sky" title={t('common.notFound')} /> : <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 32 }} />}
      </Screen>
    );
  const fmt = (v: number) => money(v, currency, i18n.language);
  const d = s.differenceMinor ?? 0;
  return (
    <Screen back title={t('shift.reportTitle')} subtitle={`${s.number} · ${s.userName}`}>
      <Card>
        <Text variant="caption">
          {dateTimeLabel(i18n.language, s.openedAt)} → {s.closedAt ? dateTimeLabel(i18n.language, s.closedAt) : t('shift.stillOpen')}
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          {[
            [t('shift.expected'), sum.expectedCashMinor, colors.ink.DEFAULT],
            [t('shift.counted'), s.countedCashMinor ?? 0, colors.primary[700]],
            [t('shift.difference'), d, d === 0 ? colors.leaf[700] : d < 0 ? colors.rose[700] : colors.amber[700]],
          ].map(([l, v, c]) => (
            <View key={String(l)} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: colors.paper.DEFAULT }}>
              <Text variant="caption">{l as string}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: c as string }}>{fmt(v as number)}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Card>
        <Row l={t('shift.sales')} v={`${fmt(sum.salesTotalMinor)} (${sum.salesCount})`} />
        {sum.returnsTotalMinor ? <Row l={t('shift.returns')} v={fmt(sum.returnsTotalMinor)} /> : null}
        {Object.entries(sum.byMethod).map(([k, v]) => (
          <Row key={k} l={t(`pay.methods.${k}`)} v={fmt(v)} />
        ))}
        <View style={{ height: 1, backgroundColor: colors.paper.line, marginVertical: 6 }} />
        <Row l={t('shift.float')} v={fmt(sum.openingFloatMinor)} />
        {Object.entries(sum.cashIn).map(([k, v]) => (
          <Row key={`i${k}`} l={`+ ${t(`shift.kind.${k}`)}`} v={fmt(v)} />
        ))}
        {Object.entries(sum.cashOut).map(([k, v]) => (
          <Row key={`o${k}`} l={`− ${t(`shift.kind.${k}`)}`} v={fmt(v)} />
        ))}
        {s.note ? <Text variant="caption" style={{ marginTop: 6 }}>{s.note}</Text> : null}
      </Card>
      <ExportBar build={async () => shiftDoc(s, sum, await bizHeader())} kinds={['whatsapp', 'print', 'pdf']} />
    </Screen>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <Text variant="body">{l}</Text>
      <Text variant="label" style={{ color: colors.ink.DEFAULT }}>{v}</Text>
    </View>
  );
}
