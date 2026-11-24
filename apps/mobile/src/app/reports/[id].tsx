import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NoScreenshots } from '../../features/NoScreenshots';
import { businessDay, roleHas } from '@daftarak/shared';
import { Screen, Chip, Text, Banner, Button, EmptyState } from '../../ui';
import { hasFeature } from '../../domain/licence/guard';
import { errorMessage } from '../../lib/errors';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { REPORTS } from '../../features/reports/defs';
import { ReportDocView } from '../../features/reports/ReportDocView';
import { DateRangeBar, presetRange, type RangeKey } from '../../features/common/DateRange';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader } from '../../features/export/builders';
import type { ReportDoc } from '../../features/export/report';
import { maybeShowInterstitial } from '../../features/ads/ads';
import { EyeToggle } from '../../features/privacy/EyeToggle';
import { useSensitive } from '../../state/privacy';

/** One screen for every report: date filter → numbers → WhatsApp / PDF / Excel / print. */
export default function ReportScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const def = REPORTS.find((r) => r.id === id);
  const user = useApp((s) => s.user)!;
  const { masked } = useSensitive();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [range, setRange] = useState<{ key: RangeKey; from: number; to: number }>(() => {
    const [from, to] = presetRange('month', today);
    return { key: 'month', from, to };
  });
  const [opt, setOpt] = useState(def?.options?.default ?? 0);
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const noPerm = !!def && !roleHas(user.permissions, def.perm);
  const noFeature = !!def?.feature && !hasFeature(def.feature);
  const allowed = !!def && !noPerm && !noFeature;

  useEffect(() => {
    if (!def || !allowed) return;
    let live = true;
    setLoading(true);
    setErr(null);
    void (async () => {
      try {
        const s = Date.now();
        const d = await def.build(getDb(), { range, today, opt, user, biz: await bizHeader() });
        if (live) {
          setDoc(d);
          setMs(Date.now() - s);
        }
      } catch (e) {
        if (live) setErr(errorMessage(t, e));
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [def, allowed, range.from, range.to, opt, today, user]); // eslint-disable-line react-hooks/exhaustive-deps
  // Closing a report is an allowed moment for an interstitial (free plan, ≤ 1 per 15 min).
  useEffect(() => () => maybeShowInterstitial(), []);
  const build = useMemo(() => () => doc!, [doc]);

  if (!def) return <Screen back>{null}</Screen>;
  if (!allowed) {
    return (
      <Screen back title={t(`reports.names.${def.id}`)}>
        {noPerm ? (
          <EmptyState icon="lock" hue="rose" title={t('users.noPermission')} />
        ) : (
          <EmptyState icon="lock" hue="amber" title={t('licence.feature')}>
            <Button title={t('more.subscription')} onPress={() => router.push('/settings/subscription')} />
          </EmptyState>
        )}
      </Screen>
    );
  }
  return (
    <Screen back title={t(`reports.names.${def.id}`)} subtitle={doc?.period ?? undefined} right={<EyeToggle />}>
      <NoScreenshots id="report" />
      {def.ranged ? <DateRangeBar value={range} today={today} onChange={setRange} presets={['today', 'week', 'month', 'lastMonth', 'quarter', 'year', 'custom']} /> : null}
      {def.options ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {def.options.values.map((v) => (
            <Chip key={v} label={t('reports.days', { n: v })} selected={opt === v} onPress={() => setOpt(v)} />
          ))}
        </View>
      ) : null}
      {err ? <Banner tone="danger" text={err} /> : null}
      {loading && !doc ? <Text variant="caption" style={{ textAlign: 'center' }}>{t('common.loading')}</Text> : null}
      {doc ? (
        <>
          <ExportBar build={build} kinds={['pdf', 'excel', 'print', 'whatsapp']} />
          <ReportDocView d={doc} masked={masked} />
          {__DEV__ && ms != null ? <Text variant="caption">{ms} ms</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}
