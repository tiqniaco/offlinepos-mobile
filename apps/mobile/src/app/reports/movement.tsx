import { useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, formatQty } from '@daftarak/shared';
import { Screen } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { stockMovementFor } from '../../domain/reports/reports';
import { getProduct } from '../../domain/inventory/products';
import { DateRangeBar, presetRange, type RangeKey } from '../../features/common/DateRange';
import { ExportBar } from '../../features/common/ExportBar';
import { ReportDocView } from '../../features/reports/ReportDocView';
import { bizHeader, dayText } from '../../features/export/builders';
import type { ReportDoc } from '../../features/export/report';

/** Stock movement of one product with opening / running / closing balance (SPEC §5 reports). */
export default function MovementReport() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [range, setRange] = useState<{ key: RangeKey; from: number; to: number }>(() => {
    const [from, to] = presetRange('month', today);
    return { key: 'month', from, to };
  });
  const [doc, setDoc] = useState<ReportDoc | null>(null);
  useEffect(() => {
    void (async () => {
      const db = getDb();
      const p = await getProduct(db, id);
      const mv = await stockMovementFor(db, id, range);
      setDoc({
        title: t('product.allMovements'),
        date: Date.now(),
        ...(await bizHeader()),
        vatNumber: null,
        partyLine: p?.product.name ?? '',
        period: t('report.period', { from: dayText(range.from), to: dayText(range.to) }),
        summary: [
          { label: t('report.opening'), value: formatQty(mv.openingMilli) },
          { label: t('report.closing'), value: formatQty(mv.closingMilli), strong: true },
        ],
        columns: [
          { key: 'desc', label: t('report.desc') },
          { key: 'qty', label: t('reports.col.qty'), num: true },
          { key: 'bal', label: t('report.balance'), num: true },
        ],
        rows: mv.rows.map((r) => {
          const desc = `${dayText(r.day)} · ${t(`movement.${r.type}`, { defaultValue: r.type })}${r.num ? ` ${r.num}` : ''}`;
          return { cells: { desc, qty: `${r.qty > 0 ? '+' : ''}${formatQty(r.qty)}`, bal: formatQty(r.balanceMilli) }, values: { desc, qty: r.qty / 1000, bal: r.balanceMilli / 1000 } };
        }),
        totals: [],
        fileName: `movement-${p?.product.name ?? id}`,
      });
    })();
  }, [id, range.from, range.to, t]);
  const build = useMemo(() => () => doc!, [doc]);
  return (
    <Screen back title={t('product.allMovements')} subtitle={doc?.partyLine ?? undefined}>
      <DateRangeBar value={range} today={today} onChange={setRange} />
      {doc ? (
        <>
          <ExportBar build={build} kinds={['pdf', 'excel', 'print']} />
          <ReportDocView d={doc} />
        </>
      ) : null}
    </Screen>
  );
}
