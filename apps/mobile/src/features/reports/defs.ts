/**
 * Report catalogue: each report = SQL aggregate (domain/reports) → ReportDoc (same model as statements),
 * so every report has the same screen, the same PDF / Excel / print / WhatsApp, and the same look.
 * Gating: reports.view for all; profit/cost columns need profit.view / cost.view; advanced reports need the
 * plan feature `adv_reports` (Pro), expiring items need `expiry`.
 */
import i18n from 'i18next';
import { formatMinor, formatQty, roleHas, type Feature, type Permission } from '@daftarak/shared';
import type { Db } from '../../db/types';
import type { SessionUser } from '../../domain/auth/users';
import { aging, discountsByUser, expiringItems, profitAndLoss, purchasesBySupplier, salesBy, salesRounding, shiftsReport, slowStock, stockValuation, stockValuationTotals, type Range, type SalesGroup } from '../../domain/reports/reports';
import { expenseTotals, listVouchers } from '../../domain/vouchers/vouchers';
import type { IconName, Hue } from '../../ui';
import type { ReportDoc } from '../export/report';
import { dayText, expensesDoc, type BizHeader } from '../export/builders';
import { listCounts } from '../../domain/inventory/counts';
import { countsListDoc } from '../inventory/countDoc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;
const m = (v: number) => formatMinor(v);

export type ReportId =
  | 'sales_day'
  | 'sales_product'
  | 'sales_category'
  | 'sales_customer'
  | 'sales_user'
  | 'discounts_user'
  | 'purchases'
  | 'pnl'
  | 'stock_valuation'
  | 'slow_stock'
  | 'expiring'
  | 'aging_c'
  | 'aging_s'
  | 'expenses'
  | 'shifts'
  | 'stock_counts';

export interface ReportDef {
  id: ReportId;
  group: 'sales' | 'money' | 'stock';
  icon: IconName;
  hue: Hue;
  perm: Permission;
  feature?: Feature;
  /** false = "as of today" (no date filter). */
  ranged: boolean;
  /** Extra option chips (e.g. slow-stock days). */
  options?: { key: string; values: number[]; default: number };
  build: (db: Db, x: { range: Range; today: number; opt: number; user: SessionUser; biz: BizHeader }) => Promise<ReportDoc>;
}

const period = (r: Range) => t('report.period', { from: dayText(r.from), to: dayText(r.to) });
const base = (id: ReportId, biz: BizHeader, extra: Partial<ReportDoc>): ReportDoc => ({
  title: t(`reports.names.${id}`),
  date: Date.now(),
  ...biz,
  vatNumber: null,
  summary: [],
  columns: [],
  rows: [],
  totals: [],
  fileName: `${id}-${new Date().toISOString().slice(0, 10)}`,
  ...extra,
});

function salesReport(id: ReportId, group: SalesGroup): ReportDef['build'] {
  return async (db, { range, user, biz }) => {
    const rows = await salesBy(db, group, range);
    // Lines don't carry the invoice's cash rounding: show it as its own row so the total matches documents and shifts.
    const rounding = await salesRounding(db, range);
    const profit = roleHas(user.permissions, 'profit.view');
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    const label = (r: (typeof rows)[number]) => (group === 'day' ? dayText(Number(r.label)) : r.label || (group === 'customer' ? t('pos.walkIn') : '—'));
    return base(id, biz, {
      period: period(range),
      summary: [
        { label: t('reports.col.sales'), value: m(sum((r) => r.salesMinor)), strong: true },
        ...(profit ? [{ label: t('reports.col.profit'), value: m(sum((r) => r.profitMinor)) }] : []),
      ],
      columns: [
        { key: 'name', label: t(`reports.dim.${group}`) },
        ...(group === 'product' ? [{ key: 'qty', label: t('reports.col.qty'), num: true }] : [{ key: 'inv', label: t(group === 'category' ? 'reports.col.lines' : 'reports.col.invoices'), num: true }]),
        { key: 'sales', label: t('reports.col.sales'), num: true },
        ...(profit ? [{ key: 'profit', label: t('reports.col.profit'), num: true }] : []),
        { key: 'disc', label: t('reports.col.discounts'), num: true, wideOnly: true },
        { key: 'rets', label: t('reports.col.returns'), num: true, wideOnly: true },
      ],
      rows: rows.map((r) => ({
        cells: { name: label(r), qty: formatQty(r.qtyMilli), inv: String(r.invoices), sales: m(r.salesMinor), profit: m(r.profitMinor), disc: m(r.discountMinor), rets: m(r.returnsMinor) },
        values: { name: label(r), qty: r.qtyMilli / 1000, inv: r.invoices, sales: r.salesMinor / 100, profit: r.profitMinor / 100, disc: r.discountMinor / 100, rets: r.returnsMinor / 100 },
      })),
      totals: [
        { label: t('reports.col.sales'), value: m(sum((r) => r.salesMinor)), strong: true },
        { label: t('reports.col.tax'), value: m(sum((r) => r.taxMinor)) },
        { label: t('reports.col.discounts'), value: m(sum((r) => r.discountMinor)) },
        { label: t('reports.col.returns'), value: m(sum((r) => r.returnsMinor)) },
        ...(rounding !== 0
          ? [
              { label: t('reports.col.rounding'), value: m(rounding) },
              { label: t('reports.col.salesAfterRounding'), value: m(sum((r) => r.salesMinor) + rounding), strong: true },
            ]
          : []),
        ...(profit ? [{ label: t('reports.col.profit'), value: m(sum((r) => r.profitMinor)), strong: true }] : []),
      ],
    });
  };
}

function agingReport(id: ReportId, type: 'C' | 'S'): ReportDef['build'] {
  return async (db, { today, biz }) => {
    const rows = await aging(db, type, today);
    const tot = [0, 1, 2, 3].map((i) => rows.reduce((s, r) => s + r.buckets[i]!, 0));
    return base(id, biz, {
      period: dayText(today),
      summary: [{ label: t('reports.col.total'), value: m(rows.reduce((s, r) => s + r.totalMinor, 0)), strong: true }],
      columns: [
        { key: 'name', label: t(type === 'C' ? 'parties.customer' : 'parties.supplier') },
        { key: 'b0', label: '0-30', num: true },
        { key: 'b1', label: '31-60', num: true },
        { key: 'b2', label: '61-90', num: true, wideOnly: true },
        { key: 'b3', label: '+90', num: true },
        { key: 'total', label: t('reports.col.total'), num: true },
      ],
      rows: rows.map((r) => ({ cells: { name: r.name, b0: m(r.buckets[0]), b1: m(r.buckets[1]), b2: m(r.buckets[2]), b3: m(r.buckets[3]), total: m(r.totalMinor) }, values: { name: r.name, b0: r.buckets[0] / 100, b1: r.buckets[1] / 100, b2: r.buckets[2] / 100, b3: r.buckets[3] / 100, total: r.totalMinor / 100 } })),
      totals: [
        { label: '0-30', value: m(tot[0]!) },
        { label: '31-60', value: m(tot[1]!) },
        { label: '61-90', value: m(tot[2]!) },
        { label: t('reports.over90'), value: m(tot[3]!), strong: true },
      ],
    });
  };
}

export const REPORTS: ReportDef[] = [
  { id: 'sales_day', group: 'sales', icon: 'calendar', hue: 'primary', perm: 'reports.view', ranged: true, build: salesReport('sales_day', 'day') },
  { id: 'sales_product', group: 'sales', icon: 'box', hue: 'primary', perm: 'reports.view', ranged: true, build: salesReport('sales_product', 'product') },
  { id: 'sales_category', group: 'sales', icon: 'layers', hue: 'sky', perm: 'reports.view', ranged: true, build: salesReport('sales_category', 'category') },
  { id: 'sales_customer', group: 'sales', icon: 'users', hue: 'leaf', perm: 'reports.view', ranged: true, build: salesReport('sales_customer', 'customer') },
  { id: 'sales_user', group: 'sales', icon: 'users', hue: 'amber', perm: 'reports.view', feature: 'adv_reports', ranged: true, build: salesReport('sales_user', 'user') },
  {
    id: 'discounts_user',
    group: 'sales',
    icon: 'tag',
    hue: 'rose',
    perm: 'reports.view',
    feature: 'adv_reports',
    ranged: true,
    build: async (db, { range, biz }) => {
      const rows = await discountsByUser(db, range);
      return base('discounts_user', biz, {
        period: period(range),
        columns: [
          { key: 'name', label: t('reports.dim.user') },
          { key: 'manual', label: t('reports.col.manual'), num: true },
          { key: 'offers', label: t('reports.col.offers'), num: true },
          { key: 'coupons', label: t('reports.col.coupons'), num: true },
          { key: 'pct', label: '%', num: true },
        ],
        rows: rows.map((r) => {
          const manual = r.lineMinor + r.invoiceMinor;
          const pct = r.grossMinor ? ((manual * 100) / r.grossMinor).toFixed(1) : '0';
          return { cells: { name: r.label, manual: m(manual), offers: m(r.offersMinor), coupons: m(r.couponsMinor), pct }, values: { name: r.label, manual: manual / 100, offers: r.offersMinor / 100, coupons: r.couponsMinor / 100, pct: Number(pct) } };
        }),
        totals: [{ label: t('reports.col.manual'), value: m(rows.reduce((s, r) => s + r.lineMinor + r.invoiceMinor, 0)), strong: true }],
      });
    },
  },
  {
    id: 'purchases',
    group: 'money',
    icon: 'cart',
    hue: 'primary',
    perm: 'reports.view',
    ranged: true,
    build: async (db, { range, biz }) => {
      const rows = await purchasesBySupplier(db, range);
      return base('purchases', biz, {
        period: period(range),
        summary: [{ label: t('reports.col.total'), value: m(rows.reduce((s, r) => s + r.totalMinor, 0)), strong: true }],
        columns: [
          { key: 'name', label: t('parties.supplier') },
          { key: 'n', label: t('reports.col.invoices'), num: true },
          { key: 'total', label: t('reports.col.total'), num: true },
          { key: 'credit', label: t('purchase.onCredit'), num: true },
        ],
        rows: rows.map((r) => ({ cells: { name: r.label, n: String(r.invoices), total: m(r.totalMinor), credit: m(r.creditMinor) }, values: { name: r.label, n: r.invoices, total: r.totalMinor / 100, credit: r.creditMinor / 100 } })),
        totals: [
          { label: t('reports.col.total'), value: m(rows.reduce((s, r) => s + r.totalMinor, 0)), strong: true },
          { label: t('purchase.paidNow'), value: m(rows.reduce((s, r) => s + r.paidMinor, 0)) },
          { label: t('reports.col.returns'), value: m(rows.reduce((s, r) => s + r.returnsMinor, 0)) },
        ],
      });
    },
  },
  {
    id: 'pnl',
    group: 'money',
    icon: 'chart',
    hue: 'leaf',
    perm: 'profit.view',
    feature: 'adv_reports',
    ranged: true,
    build: async (db, { range, biz }) => {
      const p = await profitAndLoss(db, range);
      const line = (k: string, v: number, strong = false) => ({ cells: { name: t(`reports.pnl.${k}`), v: m(v) }, values: { name: t(`reports.pnl.${k}`), v: v / 100 }, muted: false, ...(strong ? {} : {}) });
      return base('pnl', biz, {
        period: period(range),
        summary: [
          { label: t('reports.pnl.gross'), value: m(p.grossProfitMinor) },
          { label: t('reports.pnl.net'), value: m(p.netProfitMinor), strong: true },
        ],
        columns: [
          { key: 'name', label: t('report.desc') },
          { key: 'v', label: t('reports.col.amount'), num: true },
        ],
        rows: [
          line('sales', p.salesMinor),
          line('returns', -p.returnsMinor),
          line('netSales', p.netSalesMinor),
          line('cogs', -p.cogsMinor),
          line('gross', p.grossProfitMinor, true),
          ...p.expensesByCategory.map((e) => ({ cells: { name: `  ${e.name}`, v: m(-e.amountMinor) }, values: { name: e.name, v: -e.amountMinor / 100 } })),
          line('stockAdj', -p.stockAdjMinor),
          line('overShort', -p.cashOverShortMinor),
          line('rounding', p.roundingMinor),
        ],
        totals: [
          { label: t('reports.pnl.gross'), value: m(p.grossProfitMinor) },
          { label: t('reports.pnl.expenses'), value: m(p.expensesMinor) },
          { label: t('reports.pnl.net'), value: m(p.netProfitMinor), strong: true },
        ],
      });
    },
  },
  {
    id: 'stock_valuation',
    group: 'stock',
    icon: 'box',
    hue: 'amber',
    perm: 'cost.view',
    ranged: false,
    build: async (db, { today, biz }) => {
      const rows = await stockValuation(db);
      // Owned stock only; value sold below zero is shown apart (it is not stock you have).
      const { valueMinor: value, negativeMinor, retailMinor: retail } = stockValuationTotals(rows);
      return base('stock_valuation', biz, {
        period: dayText(today),
        summary: [
          { label: t('reports.col.costValue'), value: m(value), strong: true },
          { label: t('reports.col.retailValue'), value: m(retail) },
        ],
        columns: [
          { key: 'name', label: t('report.item') },
          { key: 'qty', label: t('reports.col.qty'), num: true },
          { key: 'avg', label: t('reports.col.avgCost'), num: true, wideOnly: true },
          { key: 'value', label: t('reports.col.costValue'), num: true },
        ],
        rows: rows.filter((r) => r.qtyMilli !== 0).map((r) => ({ cells: { name: r.name, qty: `${formatQty(r.qtyMilli)} ${r.unit}`, avg: m(r.avgCostMinor), value: m(r.valueMinor) }, values: { name: r.name, qty: r.qtyMilli / 1000, avg: r.avgCostMinor / 100, value: r.valueMinor / 100 } })),
        totals: [
          { label: t('reports.col.costValue'), value: m(value), strong: true },
          { label: t('reports.col.retailValue'), value: m(retail) },
          { label: t('reports.col.expectedProfit'), value: m(retail - value) },
          ...(negativeMinor !== 0 ? [{ label: t('reports.col.negativeStockValue'), value: m(negativeMinor) }] : []),
        ],
      });
    },
  },
  {
    id: 'slow_stock',
    group: 'stock',
    icon: 'clock',
    hue: 'rose',
    perm: 'reports.view',
    feature: 'adv_reports',
    ranged: false,
    options: { key: 'days', values: [30, 60, 90, 180], default: 60 },
    build: async (db, { today, opt, biz }) => {
      const rows = await slowStock(db, today, opt);
      return base('slow_stock', biz, {
        period: t('reports.noSalesFor', { n: opt }),
        summary: [{ label: t('reports.col.items'), value: String(rows.length) }, { label: t('reports.col.costValue'), value: m(rows.reduce((s, r) => s + r.valueMinor, 0)), strong: true }],
        columns: [
          { key: 'name', label: t('report.item') },
          { key: 'qty', label: t('reports.col.qty'), num: true },
          { key: 'last', label: t('reports.col.lastSale'), num: true },
          { key: 'value', label: t('reports.col.costValue'), num: true },
        ],
        rows: rows.map((r) => ({ cells: { name: r.name, qty: formatQty(r.qtyMilli), last: r.lastSaleDay ? dayText(r.lastSaleDay) : t('reports.never'), value: m(r.valueMinor) }, values: { name: r.name, qty: r.qtyMilli / 1000, last: r.lastSaleDay ? dayText(r.lastSaleDay) : '', value: r.valueMinor / 100 } })),
        totals: [],
      });
    },
  },
  {
    id: 'expiring',
    group: 'stock',
    icon: 'warning',
    hue: 'amber',
    perm: 'reports.view',
    feature: 'expiry',
    ranged: false,
    options: { key: 'days', values: [7, 30, 60, 90], default: 30 },
    build: async (db, { today, opt, biz }) => {
      const rows = await expiringItems(db, today, opt);
      return base('expiring', biz, {
        period: t('reports.within', { n: opt }),
        columns: [
          { key: 'name', label: t('report.item') },
          { key: 'batch', label: t('reports.col.batch'), wideOnly: true },
          { key: 'exp', label: t('reports.col.expiry'), num: true },
          { key: 'qty', label: t('reports.col.qty'), num: true },
        ],
        rows: rows.map((r) => ({ muted: r.expired, cells: { name: r.expired ? `⚠ ${r.name}` : r.name, batch: r.batchNo ?? '', exp: dayText(r.expiryDay), qty: formatQty(r.qtyMilli) }, values: { name: r.name, batch: r.batchNo ?? '', exp: dayText(r.expiryDay), qty: r.qtyMilli / 1000 } })),
      });
    },
  },
  { id: 'aging_c', group: 'money', icon: 'users', hue: 'rose', perm: 'reports.view', feature: 'adv_reports', ranged: false, build: agingReport('aging_c', 'C') },
  { id: 'aging_s', group: 'money', icon: 'truck', hue: 'amber', perm: 'reports.view', feature: 'adv_reports', ranged: false, build: agingReport('aging_s', 'S') },
  {
    id: 'expenses',
    group: 'money',
    icon: 'wallet',
    hue: 'rose',
    perm: 'reports.view',
    ranged: true,
    build: async (db, { range, biz }) => expensesDoc(await listVouchers(db, { types: ['EXPENSE'], from: range.from, to: range.to, limit: 5000 }), await expenseTotals(db, range.from, range.to), range.from, range.to, biz),
  },
  {
    id: 'shifts',
    group: 'money',
    icon: 'clock',
    hue: 'ink',
    perm: 'reports.view',
    ranged: true,
    build: async (db, { range, biz }) => {
      const rows = await shiftsReport(db, range);
      return base('shifts', biz, {
        period: period(range),
        columns: [
          { key: 'name', label: t('shift.cashier') },
          { key: 'num', label: '#', wideOnly: true },
          { key: 'exp', label: t('shift.expected'), num: true },
          { key: 'cnt', label: t('shift.counted'), num: true },
          { key: 'diff', label: t('shift.difference'), num: true },
        ],
        rows: rows.map((r) => ({ cells: { name: r.user, num: r.number, exp: m(Number(r.expected ?? 0)), cnt: r.counted == null ? t('shift.stillOpen') : m(Number(r.counted)), diff: m(Number(r.diff ?? 0)) }, values: { name: r.user, num: r.number, exp: Number(r.expected ?? 0) / 100, cnt: Number(r.counted ?? 0) / 100, diff: Number(r.diff ?? 0) / 100 } })),
        totals: [{ label: t('shift.difference'), value: m(rows.reduce((s, r) => s + Number(r.diff ?? 0), 0)), strong: true }],
      });
    },
  },
  {
    // Opens its own screen (products/counts); build() is the same list as a shareable report.
    id: 'stock_counts',
    group: 'stock',
    icon: 'clipboard',
    hue: 'sky',
    perm: 'reports.view',
    ranged: false,
    build: async (db, { user, biz }) => countsListDoc(await listCounts(db), biz, roleHas(user.permissions, 'cost.view')),
  },
];
