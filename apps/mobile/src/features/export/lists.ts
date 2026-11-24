/**
 * ReportDocs for whole LISTS (customers, suppliers, invoices, purchases, vouchers, shifts, offers, users,
 * products): one table each, same PDF/Excel path as every other report. Pure (no database): the screen
 * loads the rows with its current filter and passes them here, so the file matches what the user picked.
 */
import { formatQty } from '@daftarak/shared';
import type { ReportDoc, ReportRow } from './report';
import { balanceWords, cur, dayText, m, stamp, t, type BizHeader } from './fmt';

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-11-24 14:05" in the phone's local time, Latin digits. */
export const dateTimeText = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Local form of a saved E.164 phone ("201012345678" → "01012345678"); kept as text so Excel keeps the 0. */
export const phoneText = (intl: string | null | undefined) => {
  if (!intl) return '';
  const d = intl.replace(/[^\d]/g, '');
  if (/^20(10|11|12|15)\d{8}$/.test(d)) return `0${d.slice(2)}`;
  if (/^9665\d{8}$/.test(d)) return `0${d.slice(3)}`;
  return d;
};
const periodOf = (r?: { from: number; to: number } | null) => (r ? t('report.period', { from: dayText(r.from), to: dayText(r.to) }) : null);
const money = (v: number) => v / 100;
const countLine = (n: number) => ({ label: t('lists.count'), value: String(n), plain: true });

// ─────────────────────────── customers / suppliers ───────────────────────────

export interface PartyListDocRow {
  name: string;
  mobile: string | null;
  address: string | null;
  creditLimitMinor: number | null;
  /** Ledger balance (debit − credit), as listParties returns it. */
  balanceMinor: number;
}

export function partiesListDoc(type: 'C' | 'S', rows: PartyListDocRow[], b: BizHeader, opts: { filterLabel?: string | null } = {}): ReportDoc {
  const c = b.currency;
  const owed = (bal: number) => (type === 'C' ? bal : -bal);
  const owing = rows.reduce((s, r) => s + Math.max(0, owed(r.balanceMinor)), 0);
  const credit = rows.reduce((s, r) => s + Math.max(0, -owed(r.balanceMinor)), 0);
  const title = t(type === 'C' ? 'lists.customersTitle' : 'lists.suppliersTitle');
  return {
    title,
    date: Date.now(),
    period: opts.filterLabel ?? null,
    ...b,
    vatNumber: null,
    summary: [countLine(rows.length), { label: t(type === 'C' ? 'parties.totalOwedC' : 'parties.totalOwedS'), value: `${m(owing)} ${cur(c)}`, strong: true }],
    columns: [
      { key: 'name', label: t('importer.fields.name') },
      { key: 'mobile', label: t('parties.mobile'), plain: true },
      { key: 'address', label: t('parties.address'), wideOnly: true, plain: true },
      ...(type === 'C' ? [{ key: 'limit', label: t('parties.creditLimit'), num: true, wideOnly: true }] : []),
      { key: 'balance', label: t('report.balance'), num: true },
    ],
    rows: rows.map((r) => {
      const o = owed(r.balanceMinor);
      return {
        cells: { name: r.name, mobile: phoneText(r.mobile), address: r.address ?? '', limit: r.creditLimitMinor ? m(r.creditLimitMinor) : '', balance: balanceWords(type, o, c) },
        values: { name: r.name, mobile: phoneText(r.mobile), address: r.address ?? '', limit: r.creditLimitMinor ? money(r.creditLimitMinor) : '', balance: money(o) },
        muted: o === 0,
      };
    }),
    totals: [
      { label: t(type === 'C' ? 'parties.totalOwedC' : 'parties.totalOwedS'), value: `${m(owing)} ${cur(c)}`, strong: true },
      ...(credit ? [{ label: t(type === 'C' ? 'lists.creditTotalC' : 'lists.creditTotalS'), value: `${m(credit)} ${cur(c)}` }] : []),
    ],
    note: t('lists.balanceNote'),
    fileName: `${type === 'C' ? 'customers' : 'suppliers'}-${stamp()}`,
  };
}

// ─────────────────────────── sales invoices ───────────────────────────

export interface SaleListDocRow {
  number: string | null;
  type: string;
  status: string;
  customerName: string | null;
  totalMinor: number;
  creditMinor: number;
  postedAt: number | null;
}

export function salesListDoc(rows: SaleListDocRow[], b: BizHeader, opts: { range?: { from: number; to: number } | null; search?: string | null } = {}): ReportDoc {
  const c = b.currency;
  const live = rows.filter((r) => r.status === 'POSTED');
  const sales = live.filter((r) => r.type === 'INVOICE').reduce((s, r) => s + r.totalMinor, 0);
  const returns = live.filter((r) => r.type === 'RETURN').reduce((s, r) => s + r.totalMinor, 0);
  const credit = live.filter((r) => r.type === 'INVOICE').reduce((s, r) => s + r.creditMinor, 0);
  const kind = (r: SaleListDocRow) => (r.status === 'VOIDED' ? t('invoice.voided') : r.type === 'RETURN' ? t('invoice.return') : r.creditMinor > 0 ? t('invoice.credit') : t('lists.invoice'));
  const sign = (r: SaleListDocRow) => (r.type === 'RETURN' ? -1 : 1);
  const period = [periodOf(opts.range), opts.search?.trim() ? t('lists.search', { q: opts.search.trim() }) : null].filter(Boolean).join(' — ');
  return {
    title: t('more.invoices'),
    date: Date.now(),
    period: period || null,
    ...b,
    vatNumber: null,
    summary: [
      { label: t('lists.invoicesCount'), value: String(live.filter((r) => r.type === 'INVOICE').length), plain: true },
      { label: t('lists.net'), value: `${m(sales - returns)} ${cur(c)}`, strong: true },
    ],
    columns: [
      { key: 'date', label: t('report.date'), plain: true },
      { key: 'number', label: t('lists.number'), plain: true },
      { key: 'customer', label: t('invoice.customer') },
      { key: 'kind', label: t('lists.kind'), wideOnly: true, plain: true },
      { key: 'credit', label: t('invoice.credit'), num: true, wideOnly: true },
      { key: 'total', label: t('report.total'), num: true },
    ],
    rows: rows.map((r) => {
      const date = r.postedAt ? dateTimeText(r.postedAt) : '';
      const customer = r.customerName ?? t('pos.walkIn');
      return {
        muted: r.status === 'VOIDED',
        cells: { date, number: r.number ?? '', customer, kind: kind(r), credit: r.creditMinor ? m(r.creditMinor) : '', total: `${sign(r) < 0 ? '-' : ''}${m(r.totalMinor)}` },
        values: { date, number: r.number ?? '', customer, kind: kind(r), credit: money(r.creditMinor), total: money(sign(r) * r.totalMinor) },
      };
    }),
    totals: [
      { label: t('lists.sales'), value: m(sales) },
      { label: t('lists.returns'), value: m(returns) },
      ...(credit ? [{ label: t('invoice.credit'), value: m(credit) }] : []),
      { label: t('lists.net'), value: `${m(sales - returns)} ${cur(c)}`, strong: true },
    ],
    fileName: opts.range ? `invoices-${dayText(opts.range.from)}-${dayText(opts.range.to)}` : `invoices-${stamp()}`,
  };
}

// ─────────────────────────── purchases ───────────────────────────

export interface PurchaseListDocRow {
  number: string | null;
  type: 'PURCHASE' | 'PURCHASE_RETURN';
  status: string;
  supplierName: string | null;
  totalMinor: number;
  paidMinor: number;
  creditMinor: number;
  postedAt: number | null;
}

export function purchasesListDoc(rows: PurchaseListDocRow[], b: BizHeader, opts: { range?: { from: number; to: number } | null; filterLabel?: string | null } = {}): ReportDoc {
  const c = b.currency;
  const live = rows.filter((r) => r.status === 'POSTED');
  const buys = live.filter((r) => r.type === 'PURCHASE').reduce((s, r) => s + r.totalMinor, 0);
  const rets = live.filter((r) => r.type === 'PURCHASE_RETURN').reduce((s, r) => s + r.totalMinor, 0);
  const credit = live.filter((r) => r.type === 'PURCHASE').reduce((s, r) => s + r.creditMinor, 0);
  const kind = (r: PurchaseListDocRow) => (r.status === 'VOIDED' ? t('invoice.voided') : r.type === 'PURCHASE_RETURN' ? t('invoice.return') : t('lists.invoice'));
  return {
    title: t('purchase.listTitle'),
    date: Date.now(),
    period: [periodOf(opts.range), opts.filterLabel].filter(Boolean).join(' — ') || null,
    ...b,
    vatNumber: null,
    summary: [countLine(live.length), { label: t('lists.net'), value: `${m(buys - rets)} ${cur(c)}`, strong: true }],
    columns: [
      { key: 'date', label: t('report.date'), plain: true },
      { key: 'number', label: t('lists.number'), plain: true },
      { key: 'supplier', label: t('purchase.supplier') },
      { key: 'kind', label: t('lists.kind'), wideOnly: true, plain: true },
      { key: 'credit', label: t('purchase.onCredit'), num: true, wideOnly: true },
      { key: 'total', label: t('report.total'), num: true },
    ],
    rows: rows.map((r) => {
      const date = r.postedAt ? dateTimeText(r.postedAt) : '';
      const supplier = r.supplierName ?? t('purchase.cashSupplier');
      const sg = r.type === 'PURCHASE_RETURN' ? -1 : 1;
      return {
        muted: r.status === 'VOIDED',
        cells: { date, number: r.number ?? '', supplier, kind: kind(r), credit: r.creditMinor ? m(r.creditMinor) : '', total: `${sg < 0 ? '-' : ''}${m(r.totalMinor)}` },
        values: { date, number: r.number ?? '', supplier, kind: kind(r), credit: money(r.creditMinor), total: money(sg * r.totalMinor) },
      };
    }),
    totals: [
      { label: t('purchase.invoices'), value: m(buys) },
      { label: t('purchase.returns'), value: m(rets) },
      ...(credit ? [{ label: t('purchase.onCredit'), value: m(credit) }] : []),
      { label: t('lists.net'), value: `${m(buys - rets)} ${cur(c)}`, strong: true },
    ],
    fileName: opts.range ? `purchases-${dayText(opts.range.from)}-${dayText(opts.range.to)}` : `purchases-${stamp()}`,
  };
}

// ─────────────────────────── vouchers (سندات) ───────────────────────────

export interface VoucherListDocRow {
  type: string;
  status: string;
  number: string;
  partyName: string | null;
  categoryName: string | null;
  method: string;
  amountMinor: number;
  postedAt: number;
  note: string | null;
}

const VOUCHER_IN = ['RECEIPT', 'SUPPLIER_REFUND', 'CASH_IN'];

export function vouchersListDoc(rows: VoucherListDocRow[], b: BizHeader, opts: { range?: { from: number; to: number } | null; filterLabel?: string | null } = {}): ReportDoc {
  const c = b.currency;
  const live = rows.filter((r) => r.status === 'POSTED');
  const inflow = live.filter((r) => VOUCHER_IN.includes(r.type)).reduce((s, r) => s + r.amountMinor, 0);
  const outflow = live.filter((r) => !VOUCHER_IN.includes(r.type) && r.type !== 'OPENING_BALANCE').reduce((s, r) => s + r.amountMinor, 0);
  const sign = (r: VoucherListDocRow) => (VOUCHER_IN.includes(r.type) ? 1 : r.type === 'OPENING_BALANCE' ? 0 : -1);
  return {
    title: t('voucher.listTitle'),
    date: Date.now(),
    period: [periodOf(opts.range), opts.filterLabel].filter(Boolean).join(' — ') || null,
    ...b,
    vatNumber: null,
    summary: [countLine(live.length), { label: t('lists.inTotal'), value: `${m(inflow)} ${cur(c)}` }, { label: t('lists.outTotal'), value: `${m(outflow)} ${cur(c)}` }],
    columns: [
      { key: 'date', label: t('report.date'), plain: true },
      { key: 'number', label: t('lists.number'), plain: true, wideOnly: true },
      { key: 'kind', label: t('lists.kind') },
      { key: 'party', label: t('lists.party') },
      { key: 'method', label: t('voucher.method'), wideOnly: true, plain: true },
      { key: 'amount', label: t('voucher.amount'), num: true },
    ],
    rows: rows.map((r) => {
      const date = dateTimeText(r.postedAt);
      const kind = `${t(`voucher.title.${r.type}`)}${r.status === 'VOIDED' ? ` (${t('invoice.voided')})` : ''}`;
      const party = r.partyName ?? r.categoryName ?? '';
      const method = r.type === 'OPENING_BALANCE' ? '' : t(`pay.methods.${r.method}`);
      const sg = sign(r);
      return {
        muted: r.status === 'VOIDED',
        cells: { date, number: r.number, kind, party, method, amount: `${sg > 0 ? '+' : sg < 0 ? '-' : ''}${m(r.amountMinor)}` },
        values: { date, number: r.number, kind, party, method, amount: money(sg === 0 ? r.amountMinor : sg * r.amountMinor) },
        sub: r.note ? [r.note] : undefined,
      };
    }),
    totals: [
      { label: t('lists.inTotal'), value: m(inflow) },
      { label: t('lists.outTotal'), value: m(outflow) },
      { label: t('lists.net'), value: `${m(inflow - outflow)} ${cur(c)}`, strong: true },
    ],
    fileName: opts.range ? `vouchers-${dayText(opts.range.from)}-${dayText(opts.range.to)}` : `vouchers-${stamp()}`,
  };
}

// ─────────────────────────── shifts ───────────────────────────

export interface ShiftListDocRow {
  number: string;
  status: string;
  userName: string;
  openedAt: number;
  closedAt: number | null;
  openingFloatMinor: number;
  expectedCashMinor: number | null;
  countedCashMinor: number | null;
  differenceMinor: number | null;
}

export function shiftsListDoc(rows: ShiftListDocRow[], b: BizHeader, opts: { range?: { from: number; to: number } | null } = {}): ReportDoc {
  const c = b.currency;
  const closed = rows.filter((r) => r.status === 'CLOSED');
  const diff = closed.reduce((s, r) => s + (r.differenceMinor ?? 0), 0);
  const short = closed.reduce((s, r) => s + Math.min(0, r.differenceMinor ?? 0), 0);
  return {
    title: t('lists.shiftsTitle'),
    date: Date.now(),
    period: periodOf(opts.range),
    ...b,
    vatNumber: null,
    summary: [countLine(rows.length), { label: t('lists.diffTotal'), value: `${diff < 0 ? '-' : ''}${m(Math.abs(diff))} ${cur(c)}`, strong: true }],
    columns: [
      { key: 'number', label: t('lists.number'), plain: true },
      { key: 'user', label: t('shift.cashier') },
      { key: 'opened', label: t('lists.opened'), plain: true, wideOnly: true },
      { key: 'closed', label: t('lists.closed'), plain: true },
      { key: 'expected', label: t('shift.expected'), num: true, wideOnly: true },
      { key: 'counted', label: t('lists.counted'), num: true },
      { key: 'diff', label: t('shift.difference'), num: true },
    ],
    rows: rows.map((r) => {
      const opened = dateTimeText(r.openedAt);
      const closedAt = r.closedAt ? dateTimeText(r.closedAt) : t('shift.stillOpen');
      return {
        cells: { number: r.number, user: r.userName, opened, closed: closedAt, expected: r.expectedCashMinor != null ? m(r.expectedCashMinor) : '', counted: r.countedCashMinor != null ? m(r.countedCashMinor) : '', diff: r.differenceMinor != null ? `${r.differenceMinor < 0 ? '-' : ''}${m(Math.abs(r.differenceMinor))}` : '' },
        values: { number: r.number, user: r.userName, opened, closed: closedAt, expected: r.expectedCashMinor != null ? money(r.expectedCashMinor) : '', counted: r.countedCashMinor != null ? money(r.countedCashMinor) : '', diff: r.differenceMinor != null ? money(r.differenceMinor) : '' },
      };
    }),
    totals: [
      ...(short ? [{ label: t('lists.shortTotal'), value: `-${m(-short)}` }] : []),
      { label: t('lists.diffTotal'), value: `${diff < 0 ? '-' : ''}${m(Math.abs(diff))} ${cur(c)}`, strong: true },
    ],
    fileName: opts.range ? `shifts-${dayText(opts.range.from)}-${dayText(opts.range.to)}` : `shifts-${stamp()}`,
  };
}

// ─────────────────────────── offers ───────────────────────────

export interface OfferListDocRow {
  name: string;
  /** "خصم %" … (offers.types.*) */
  typeLabel: string;
  /** "20% على الكل" — what the screen shows under the name. */
  summary: string;
  /** شغّال / متوقف / خلص / لسه */
  state: string;
  startsDay: number | null;
  endsDay: number | null;
  live: boolean;
}

export function offersListDoc(rows: OfferListDocRow[], b: BizHeader): ReportDoc {
  return {
    title: t('offers.title'),
    date: Date.now(),
    ...b,
    vatNumber: null,
    summary: [countLine(rows.length), { label: t('offers.running'), value: String(rows.filter((r) => r.live).length), plain: true }],
    columns: [
      { key: 'name', label: t('importer.fields.name') },
      { key: 'type', label: t('lists.kind'), plain: true },
      { key: 'rule', label: t('lists.rule'), plain: true },
      { key: 'from', label: t('lists.from'), plain: true, wideOnly: true },
      { key: 'to', label: t('lists.to'), plain: true, wideOnly: true },
      { key: 'state', label: t('lists.status'), plain: true },
    ],
    rows: rows.map((r) => {
      const cells = { name: r.name, type: r.typeLabel, rule: r.summary, from: r.startsDay ? dayText(r.startsDay) : '', to: r.endsDay ? dayText(r.endsDay) : '', state: r.state };
      return { cells, values: cells, muted: !r.live };
    }),
    totals: [],
    fileName: `offers-${stamp()}`,
  };
}

// ─────────────────────────── users ───────────────────────────

export interface UserListDocRow {
  name: string;
  roleName: string;
  isActive: boolean;
  lastLoginAt: number | null;
}

/** Names, roles and status only: never PINs, hashes or salts. */
export function usersListDoc(rows: UserListDocRow[], b: BizHeader): ReportDoc {
  return {
    title: t('users.title'),
    date: Date.now(),
    ...b,
    vatNumber: null,
    summary: [countLine(rows.length), { label: t('lists.activeCount'), value: String(rows.filter((r) => r.isActive).length), plain: true }],
    columns: [
      { key: 'name', label: t('importer.fields.name') },
      { key: 'role', label: t('users.role'), plain: true },
      { key: 'status', label: t('lists.status'), plain: true },
      { key: 'last', label: t('lists.lastLogin'), plain: true, wideOnly: true },
    ],
    rows: rows.map((r) => {
      const cells = { name: r.name, role: r.roleName, status: r.isActive ? t('lists.active') : t('users.disabled'), last: r.lastLoginAt ? dateTimeText(r.lastLoginAt) : t('lists.never') };
      return { cells, values: cells, muted: !r.isActive };
    }),
    totals: [],
    fileName: `users-${stamp()}`,
  };
}

// ─────────────────────────── products ───────────────────────────

export interface ProductListDocRow {
  name: string;
  variantLabel: string | null;
  category: string | null;
  unitName: string;
  barcode: string | null;
  costMinor: number;
  retailPriceMinor: number;
  qtyMilli: number;
  trackStock: boolean;
}

/** Price list / stock list. Cost and stock value only with `includeCost` (cost.view). */
export function productsListDoc(rows: ProductListDocRow[], b: BizHeader, opts: { includeCost: boolean; filterLabel?: string | null }): ReportDoc {
  const c = b.currency;
  const value = rows.reduce((s, r) => s + (r.trackStock && r.qtyMilli > 0 ? Math.round((r.costMinor * r.qtyMilli) / 1000) : 0), 0);
  return {
    title: t('lists.productsTitle'),
    date: Date.now(),
    period: opts.filterLabel ?? null,
    ...b,
    vatNumber: null,
    summary: [countLine(rows.length), ...(opts.includeCost ? [{ label: t('lists.stockValue'), value: `${m(value)} ${cur(c)}`, strong: true }] : [])],
    columns: [
      { key: 'name', label: t('report.item') },
      { key: 'barcode', label: t('importer.fields.barcode'), plain: true, wideOnly: true },
      { key: 'category', label: t('productForm.category'), plain: true, wideOnly: true },
      { key: 'qty', label: t('line.qty'), num: true, plain: true },
      ...(opts.includeCost ? [{ key: 'cost', label: t('productForm.cost'), num: true, wideOnly: true }] : []),
      { key: 'price', label: t('importer.fields.retail_price'), num: true },
    ],
    rows: rows.map((r): ReportRow => {
      const name = r.variantLabel ? `${r.name} - ${r.variantLabel}` : r.name;
      const qty = r.trackStock ? `${formatQty(r.qtyMilli)} ${r.unitName}` : '—';
      return {
        cells: { name, barcode: r.barcode ?? '', category: r.category ?? '', qty, cost: m(r.costMinor), price: m(r.retailPriceMinor) },
        values: { name, barcode: r.barcode ?? '', category: r.category ?? '', qty: r.trackStock ? r.qtyMilli / 1000 : '', cost: money(r.costMinor), price: money(r.retailPriceMinor) },
      };
    }),
    totals: opts.includeCost ? [{ label: t('lists.stockValue'), value: `${m(value)} ${cur(c)}`, strong: true }] : [],
    fileName: `products-${stamp()}`,
  };
}
