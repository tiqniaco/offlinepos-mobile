/** Count report → ReportDoc (same PDF / Excel / print / WhatsApp as every other report). */
import i18n from 'i18next';
import { formatMinor, formatQty } from '@daftarak/shared';
import type { CountReportLine, CountSummary } from '../../domain/inventory/counts';
import type { BizHeader } from '../export/builders';
import type { ReportDoc } from '../export/report';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;
const cur = (c: 'EGP' | 'SAR') => (i18n.language === 'en' ? c : c === 'SAR' ? 'ر.س' : 'ج.م');
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type CountFilter = 'all' | 'short' | 'surplus' | 'match';

export const countTitle = (c: Pick<CountSummary, 'note' | 'number'>) => c.note || c.number || t('count.title');
export const countScope = (c: Pick<CountSummary, 'categoryName' | 'categoryId'>) => (c.categoryId ? t('count.scopeOne', { name: c.categoryName ?? '—' }) : t('count.scopeAll'));

export function countDoc(c: CountSummary, lines: CountReportLine[], b: BizHeader, opts: { filter: CountFilter; showValue: boolean }): ReportDoc {
  const m = (v: number) => `${formatMinor(v)} ${cur(b.currency)}`;
  const rows = opts.filter === 'all' ? lines : lines.filter((l) => l.kind === opts.filter);
  const signed = (v: number) => (v > 0 ? `+${formatQty(v)}` : formatQty(v));
  const kind = (k: CountReportLine['kind']) => t(`countReport.${k}`);
  return {
    title: `${t('countReport.docTitle')} — ${countTitle(c)}`,
    number: c.number,
    date: c.postedAt ?? c.updatedAt,
    period: `${countScope(c)}  ·  ${t(`countReport.status.${c.status}`)}${c.userName ? `  ·  ${c.userName}` : ''}${opts.filter !== 'all' ? `  ·  ${t(`countReport.filter.${opts.filter}`)}` : ''}`,
    ...b,
    vatNumber: null,
    summary: [
      { label: t('countReport.items'), value: String(c.items), plain: true },
      { label: t('countReport.shortTitle', { n: c.shortItems }), value: opts.showValue ? m(c.shortageMinor) : String(c.shortItems), strong: true, plain: !opts.showValue },
      { label: t('countReport.surplusTitle', { n: c.surplusItems }), value: opts.showValue ? m(c.surplusMinor) : String(c.surplusItems), plain: !opts.showValue },
      ...(opts.showValue ? [{ label: t('countReport.net'), value: m(c.netMinor), strong: true }] : []),
    ],
    columns: [
      { key: 'name', label: t('countReport.col.product') },
      { key: 'expected', label: t('countReport.col.expected'), num: true, plain: true },
      { key: 'counted', label: t('countReport.col.counted'), num: true, plain: true },
      { key: 'diff', label: t('countReport.col.diff'), num: true, plain: true },
      ...(opts.showValue ? [{ key: 'value', label: t('countReport.col.value'), num: true }] : []),
      { key: 'kind', label: t('countReport.col.kind'), wideOnly: true },
    ],
    rows: rows.map((l) => {
      const name = l.variantLabel ? `${l.name} · ${l.variantLabel}` : l.name;
      return {
        muted: l.kind === 'match',
        cells: { name, expected: formatQty(l.expectedMilli), counted: formatQty(l.countedMilli), diff: signed(l.diffMilli), value: formatMinor(l.valueMinor), kind: kind(l.kind) },
        values: { name, expected: l.expectedMilli / 1000, counted: l.countedMilli / 1000, diff: l.diffMilli / 1000, value: l.valueMinor / 100, kind: kind(l.kind) },
      };
    }),
    totals: opts.showValue
      ? [
          { label: t('countReport.shortage'), value: m(c.shortageMinor) },
          { label: t('countReport.surplusValue'), value: m(c.surplusMinor) },
          { label: t('countReport.net'), value: m(c.netMinor), strong: true },
        ]
      : [],
    voided: c.status === 'DISCARDED',
    fileName: `stock-count-${c.number ?? day(c.createdAt)}`,
  };
}

/** List of all counts as one report (reports → تقرير الجرد → share the list). */
export function countsListDoc(cs: CountSummary[], b: BizHeader, showValue: boolean): ReportDoc {
  const m = (v: number) => formatMinor(v);
  return {
    title: t('countReport.title'),
    date: Date.now(),
    ...b,
    vatNumber: null,
    summary: [{ label: t('countReport.countsN'), value: String(cs.length), plain: true }],
    columns: [
      { key: 'date', label: t('report.date') },
      { key: 'name', label: t('countReport.col.count') },
      { key: 'scope', label: t('countReport.col.scope'), wideOnly: true },
      { key: 'status', label: t('countReport.col.status') },
      { key: 'items', label: t('countReport.items'), num: true, plain: true },
      ...(showValue ? [{ key: 'short', label: t('countReport.shortage'), num: true }, { key: 'surplus', label: t('countReport.surplusValue'), num: true }] : []),
    ],
    rows: cs.map((c) => {
      const cells = { date: day(c.postedAt ?? c.updatedAt), name: countTitle(c), scope: countScope(c), status: t(`countReport.status.${c.status}`), items: String(c.items), short: m(c.shortageMinor), surplus: m(c.surplusMinor) };
      return { muted: c.status === 'DISCARDED', cells, values: { ...cells, items: c.items, short: c.shortageMinor / 100, surplus: c.surplusMinor / 100 } };
    }),
    totals: [],
    fileName: `stock-counts-${new Date().toISOString().slice(0, 10)}`,
  };
}
