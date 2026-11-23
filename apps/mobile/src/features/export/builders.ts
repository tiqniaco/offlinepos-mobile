/** Build ReportDocs from domain data. Labels come from i18n (report.*) so English users get English PDFs. */
import i18n from 'i18next';
import { formatMinor, formatQty } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { business } from '../../db/schema';
import type { Statement } from '../../domain/parties/statement';
import type { ShiftSummary } from '../../domain/shifts/shifts';
import type { getPurchase } from '../../domain/purchases/purchases';
import type { vouchers, shifts } from '../../db/schema';
import type { ReportDoc } from './report';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;

export interface BizHeader {
  businessName: string;
  address: string | null;
  phones: string[];
  vatNumber: string | null;
  currency: 'EGP' | 'SAR';
}

export async function bizHeader(): Promise<BizHeader> {
  const b = (await getDb().select().from(business).limit(1))[0]!;
  return { businessName: b.name, address: b.address, phones: JSON.parse(b.phonesJson) as string[], vatNumber: b.vatRegistered ? b.vatNumber : null, currency: b.currency };
}

const cur = (c: 'EGP' | 'SAR') => (i18n.language === 'en' ? (c === 'SAR' ? 'SAR' : 'EGP') : c === 'SAR' ? 'ر.س' : 'ج.م');
const m = (v: number) => formatMinor(v);
export const dayText = (d: number) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}`;
const stamp = () => new Date().toISOString().slice(0, 10);

/** Signed balance as words: "عليه 120.00" / "له 50.00". */
export function balanceWords(type: 'C' | 'S', owedMinor: number, c: 'EGP' | 'SAR'): string {
  if (owedMinor === 0) return `${m(0)} ${cur(c)}`;
  const key = type === 'C' ? (owedMinor > 0 ? 'report.owesUs' : 'report.weOwe') : owedMinor > 0 ? 'report.weOwe' : 'report.owesUs';
  return `${t(key)} ${m(Math.abs(owedMinor))} ${cur(c)}`;
}

export function statementDoc(s: Statement, b: BizHeader, detailed: boolean): ReportDoc {
  const c = b.currency;
  const title = t(s.partyType === 'C' ? 'report.statementC' : 'report.statementS');
  const period = t('report.period', { from: dayText(s.from), to: dayText(s.to) });
  const debitLabel = t('report.debit');
  const creditLabel = t('report.credit');
  const rows = s.rows.map((r) => {
    const desc = `${t(`report.kind.${r.kind}`)}${r.number ? ` ${r.number}` : ''}${r.note ? ` — ${r.note}` : ''}`;
    return {
      cells: { date: dayText(r.day), desc, debit: r.debitMinor ? m(r.debitMinor) : '', credit: r.creditMinor ? m(r.creditMinor) : '', balance: m(r.balanceMinor) },
      values: { date: dayText(r.day), desc, debit: r.debitMinor / 100, credit: r.creditMinor / 100, balance: r.balanceMinor / 100 },
      sub: detailed ? r.items?.map((i) => `${i.name} — ${formatQty(i.qtyMilli)} ${i.unit} × ${m(i.priceMinor)} = ${m(i.totalMinor)}`) : undefined,
    };
  });
  const closing = balanceWords(s.partyType, s.closingMinor, c);
  return {
    title,
    date: Date.now(),
    period,
    ...b,
    partyLine: s.party.name,
    summary: [
      ...(s.party.mobile ? [{ label: t('parties.mobile'), value: s.party.mobile }] : []),
      { label: t('report.opening'), value: balanceWords(s.partyType, s.openingMinor, c) },
      { label: t('report.closing'), value: closing, strong: true },
    ],
    columns: [
      { key: 'date', label: t('report.date'), wideOnly: false },
      { key: 'desc', label: t('report.desc') },
      { key: 'debit', label: debitLabel, num: true },
      { key: 'credit', label: creditLabel, num: true },
      { key: 'balance', label: t('report.balance'), num: true },
    ],
    rows,
    totals: [
      { label: `${t('report.total')} ${debitLabel}`, value: m(s.totalDebitMinor) },
      { label: `${t('report.total')} ${creditLabel}`, value: m(s.totalCreditMinor) },
      { label: t('report.closing'), value: closing, strong: true },
    ],
    fileName: `statement-${s.party.name.replace(/\s+/g, '-').replace(/[\/\\:*?"<>|]/g, '-')}-${stamp()}`,
    whatsappText: [
      `*${b.businessName}*`,
      `${title} — ${s.party.name}`,
      period,
      '',
      `${t('report.opening')}: ${balanceWords(s.partyType, s.openingMinor, c)}`,
      `${t('report.total')} ${debitLabel}: ${m(s.totalDebitMinor)}`,
      `${t('report.total')} ${creditLabel}: ${m(s.totalCreditMinor)}`,
      `*${t('report.closing')}: ${closing}*`,
      '',
      ...s.rows.slice(-8).map((r) => `• ${dayText(r.day)} ${t(`report.kind.${r.kind}`)}${r.number ? ` ${r.number}` : ''}: ${m(r.debitMinor || r.creditMinor)}`),
      s.rows.length > 8 ? `… ${t('report.moreRows', { n: s.rows.length - 8 })}` : '',
    ]
      .filter((x) => x !== '')
      .join('\n'),
  };
}

export function voucherDoc(v: typeof vouchers.$inferSelect, b: BizHeader, balanceAfter?: number | null): ReportDoc {
  const c = b.currency;
  const title = t(`voucher.title.${v.type}`);
  const amount = `${m(v.amountMinor)} ${cur(c)}`;
  const party = v.partyName ?? v.categoryName ?? null;
  return {
    title,
    number: v.number,
    date: v.postedAt,
    ...b,
    partyLine: party,
    voided: v.status === 'VOIDED',
    summary: [
      { label: t('voucher.amount'), value: amount, strong: true },
      ...(v.type !== 'OPENING_BALANCE' ? [{ label: t('voucher.method'), value: `${t(`pay.methods.${v.method}`)}${v.label ? ` (${v.label})` : ''}` }] : []),
      ...(balanceAfter != null && v.partyType ? [{ label: t('report.balanceNow'), value: balanceWords(v.partyType, balanceAfter, c) }] : []),
    ],
    columns: [],
    rows: [],
    totals: [],
    note: v.note,
    fileName: `${v.number}`,
    whatsappText: [`*${b.businessName}*`, `${title} ${v.number}`, party ? `${party}` : '', `${t('voucher.amount')}: *${amount}*`, v.note ?? '', balanceAfter != null && v.partyType ? `${t('report.balanceNow')}: ${balanceWords(v.partyType, balanceAfter, c)}` : '', t('report.thanks')].filter(Boolean).join('\n'),
  };
}

export function purchaseDoc(p: NonNullable<Awaited<ReturnType<typeof getPurchase>>>, b: BizHeader): ReportDoc {
  const c = b.currency;
  const d = p.doc;
  const title = t(d.type === 'PURCHASE' ? 'purchase.title' : 'purchase.returnTitle');
  return {
    title,
    number: d.number,
    date: d.postedAt ?? d.createdAt,
    ...b,
    vatNumber: null,
    partyLine: d.supplierName ? `${t('purchase.supplier')}: ${d.supplierName}${d.supplierRef ? ` — ${t('purchase.ref')} ${d.supplierRef}` : ''}` : null,
    voided: d.status === 'VOIDED',
    summary: [],
    columns: [
      { key: 'name', label: t('report.item') },
      { key: 'qty', label: t('line.qty'), num: true },
      { key: 'price', label: t('purchase.cost'), num: true },
      { key: 'total', label: t('report.total'), num: true },
    ],
    rows: p.lines.map((l) => ({ cells: { name: l.nameSnapshot, qty: `${formatQty(l.qtyMilli)} ${l.unitNameSnapshot}`, price: m(l.unitCostMinor), total: m(l.totalMinor) }, values: { name: l.nameSnapshot, qty: l.qtyMilli / 1000, price: l.unitCostMinor / 100, total: l.totalMinor / 100 } })),
    totals: [
      ...(d.discountMinor ? [{ label: t('pos.discount'), value: `-${m(d.discountMinor)}` }] : []),
      ...(d.taxMinor ? [{ label: t('report.tax'), value: m(d.taxMinor) }] : []),
      { label: t('report.total'), value: `${m(d.totalMinor)} ${cur(c)}`, strong: true },
      { label: t('purchase.paidNow'), value: m(d.paidMinor) },
      ...(d.creditMinor ? [{ label: t('purchase.onCredit'), value: m(d.creditMinor) }] : []),
    ],
    note: d.note,
    fileName: `${d.number}`,
  };
}

export function shiftDoc(s: typeof shifts.$inferSelect, sum: ShiftSummary, b: BizHeader): ReportDoc {
  const c = b.currency;
  const kinds = (o: Record<string, number>) => Object.entries(o).map(([k, v]) => ({ label: t(`shift.kind.${k}`), value: m(v) }));
  return {
    title: t('shift.reportTitle'),
    number: s.number,
    date: s.closedAt ?? Date.now(),
    ...b,
    vatNumber: null,
    partyLine: `${t('shift.cashier')}: ${s.userName}`,
    period: `${new Date(s.openedAt).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' })} → ${s.closedAt ? new Date(s.closedAt).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'short', timeStyle: 'short' }) : t('shift.stillOpen')}`,
    summary: [
      { label: t('shift.sales'), value: `${m(sum.salesTotalMinor)} (${sum.salesCount})` },
      { label: t('shift.expected'), value: m(sum.expectedCashMinor), strong: true },
    ],
    columns: [],
    rows: [],
    totals: [
      { label: t('shift.float'), value: m(sum.openingFloatMinor) },
      ...kinds(sum.cashIn).map((x) => ({ ...x, label: `+ ${x.label}` })),
      ...kinds(sum.cashOut).map((x) => ({ ...x, label: `− ${x.label}` })),
      { label: t('shift.expected'), value: `${m(sum.expectedCashMinor)} ${cur(c)}`, strong: true },
      ...(s.countedCashMinor != null ? [{ label: t('shift.counted'), value: m(s.countedCashMinor) }, { label: t('shift.difference'), value: m(s.differenceMinor ?? 0), strong: true }] : []),
      ...Object.entries(sum.byMethod).filter(([k]) => k !== 'cash').map(([k, v]) => ({ label: t(`pay.methods.${k}`), value: m(v) })),
    ],
    note: s.note,
    fileName: `${s.number}`,
  };
}

export function expensesDoc(rows: (typeof vouchers.$inferSelect)[], totals: { name: string | null; total: number }[], from: number, to: number, b: BizHeader): ReportDoc {
  const c = b.currency;
  const live = rows.filter((r) => r.status === 'POSTED');
  const all = live.reduce((s, r) => s + r.amountMinor, 0);
  return {
    title: t('expenses.title'),
    date: Date.now(),
    period: t('report.period', { from: dayText(from), to: dayText(to) }),
    ...b,
    vatNumber: null,
    summary: [{ label: t('report.total'), value: `${m(all)} ${cur(c)}`, strong: true }],
    columns: [
      { key: 'date', label: t('report.date') },
      { key: 'cat', label: t('expenses.category') },
      { key: 'note', label: t('voucher.note'), wideOnly: true },
      { key: 'amount', label: t('voucher.amount'), num: true },
    ],
    rows: rows.map((r) => ({ muted: r.status === 'VOIDED', cells: { date: dayText(r.businessDay), cat: r.categoryName ?? '', note: r.note ?? '', amount: m(r.amountMinor) }, values: { date: dayText(r.businessDay), cat: r.categoryName ?? '', note: r.note ?? '', amount: r.amountMinor / 100 } })),
    totals: totals.map((x) => ({ label: x.name ?? '—', value: m(Number(x.total)) })),
    fileName: `expenses-${dayText(from)}-${dayText(to)}`,
  };
}
