/**
 * «تصدير» on list screens: a header button that opens a sheet with PDF · إكسيل (and, for dated lists, the
 * period). The whole list is exported with the screen's current filter, not only the rows already loaded.
 * Bulk lists are a data export, so they go through «تأكيد المدير» like the products Excel export.
 */
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { businessDay } from '@daftarak/shared';
import { Button, Sheet, Text, colors } from '../../ui';
import { ActionTiles } from '../common/ActionTiles';
import { DateRangeBar, presetRange, type RangeKey } from '../common/DateRange';
import { useApprovalGate } from '../approval/useApprovalGate';
import { approveDataExport } from '../approval/exportGate';
import { maybeShowInterstitial } from '../ads/ads';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';
import type { Approval } from '../../domain/auth/approval';
import { exportReport } from './actions';
import type { ReportDoc } from './report';

export type DayRange = { from: number; to: number };

export function ListExport({
  build,
  what,
  dated = false,
  defaultRange = 'month',
  label,
  extra,
  hideExport = false,
  testID = 'list-export',
}: {
  /** Load the rows (with the screen's filter) and make the doc. `range` is set when `dated`. */
  build: (range: DayRange | null) => Promise<ReportDoc>;
  /** Audit name of the export («تأكيد المدير» when the shop asks for it). */
  what: string;
  /** Show a period picker (sales, purchases, vouchers, shifts). */
  dated?: boolean;
  defaultRange?: RangeKey;
  /** Button text (default «تصدير»). */
  label?: string;
  /** More rows under the tiles (e.g. import from Excel). Receives a closer for the sheet. */
  extra?: (close: () => void) => React.ReactNode;
  /** Only the extra rows (the user may import but not export). */
  hideExport?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<{ key: RangeKey; from: number; to: number } | null>(null);
  const gate = useApprovalGate();
  const today = businessDay(Date.now(), tz);
  const cur = range ?? (() => {
    const [from, to] = presetRange(defaultRange, today);
    return { key: defaultRange, from, to };
  })();

  const run = (kind: 'pdf' | 'excel') => {
    if (busy) return;
    const go = async (approval: Approval | null) => {
      setBusy(true);
      try {
        await approveDataExport('export', what, approval);
        const ok = await exportReport(await build(dated ? { from: cur.from, to: cur.to } : null), kind);
        if (ok) maybeShowInterstitial();
      } catch (e) {
        toast(errorMessage(t, e), 'error');
      } finally {
        setBusy(false);
        setOpen(false);
      }
    };
    // «تأكيد المدير»: one sheet at a time, so ours closes first.
    if (gate.needs('export')) {
      setOpen(false);
      gate.run('export', (a) => go(a));
    } else void go(null);
  };

  return (
    <>
      <Button testID={testID} compact kind="secondary" icon="download" title={label ?? t('lists.export')} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => !busy && setOpen(false)} title={label ?? t('lists.exportTitle')}>
        <View style={{ gap: 12 }}>
          {hideExport ? null : (
            <>
              <Text variant="caption">{t('lists.exportHint')}</Text>
              {dated ? <DateRangeBar value={cur} today={today} onChange={setRange} presets={['today', 'week', 'month', 'lastMonth', 'year', 'all', 'custom']} /> : null}
              <View style={{ opacity: busy ? 0.55 : 1 }} pointerEvents={busy ? 'none' : 'auto'} accessibilityState={{ busy }}>
                <ActionTiles
                  flat
                  columns={2}
                  tiles={[
                    { key: 'pdf', testID: `${testID}-pdf`, icon: 'file', hue: 'rose', label: 'PDF', onPress: () => run('pdf') },
                    { key: 'excel', testID: `${testID}-excel`, icon: 'sheet', hue: 'leaf', label: t('share.excel'), onPress: () => run('excel') },
                  ]}
                />
                {busy ? <ActivityIndicator color={colors.primary[600]} style={{ position: 'absolute', alignSelf: 'center', top: '35%' }} /> : null}
              </View>
            </>
          )}
          {extra?.(() => setOpen(false))}
        </View>
      </Sheet>
      {gate.sheet}
    </>
  );
}
