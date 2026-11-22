import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay } from '@daftarak/shared';
import { Screen, Chip, Text } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { REPORTS } from '../../features/reports/defs';
import { ReportDocView } from '../../features/reports/ReportDocView';
import { DateRangeBar, presetRange, type RangeKey } from '../../features/common/DateRange';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader } from '../../features/export/builders';
import type { ReportDoc } from '../../features/export/report';
import { maybeShowInterstitial } from '../../features/ads/ads';

/** One screen for every report: date filter → numbers → WhatsApp / PDF / Excel / print. */
export default function ReportScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const def = REPORTS.find((r) => r.id === id);
  const user = useApp((s) => s.user)!;
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [range, setRange] = useState<{ key: RangeKey; from: number; to: number }>(() => {
    const [from, to] = presetRange('month', today);
    return { key: 'month', from, to };
  });
  const [opt, setOpt] = useState(def?.options?.default ?? 0);
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    if (!def) return;
    let live = true;
    void (async () => {
      const s = Date.now();
      const d = await def.build(getDb(), { range, today, opt, user, biz: await bizHeader() });
      if (live) {
        setDoc(d);
        setMs(Date.now() - s);
      }
    })();
    return () => {
      live = false;
    };
  }, [def, range.from, range.to, opt, today, user]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing a report is an allowed moment for an interstitial (free plan, ≤ 1 per 15 min).
  useEffect(() => () => maybeShowInterstitial(), []);
  const build = useMemo(() => () => doc!, [doc]);

  if (!def) return <Screen back>{null}</Screen>;
  return (
    <Screen back title={t(`reports.names.${def.id}`)} subtitle={doc?.period ?? undefined}>
      {def.ranged ? <DateRangeBar value={range} today={today} onChange={setRange} presets={['today', 'week', 'month', 'lastMonth', 'quarter', 'year', 'custom']} /> : null}
      {def.options ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {def.options.values.map((v) => (
            <Chip key={v} label={t('reports.days', { n: v })} selected={opt === v} onPress={() => setOpt(v)} />
          ))}
        </View>
      ) : null}
      {doc ? (
        <>
          <ExportBar build={build} kinds={['pdf', 'excel', 'print', 'whatsapp']} />
          <ReportDocView d={doc} />
          {__DEV__ && ms != null ? <Text variant="caption">{ms} ms</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}
