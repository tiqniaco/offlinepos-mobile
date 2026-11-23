/**
 * Account statement (كشف حساب) for any date range (SPEC §5): opening balance, every movement with its
 * document, running balance, closing balance. "Detailed" adds the items of each invoice.
 * Sales/purchase documents appear with their full total and what was paid on the spot, so the statement reads
 * like the customer's own papers; the net effect per row always equals the party ledger.
 */
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { oldestUnpaidDay, daysBetween } from '@daftarak/shared';
import { partyLedger, purchaseDocs, purchaseLines, salesDocs, salesLines, vouchers } from '../../db/schema';
import type { Db } from '../../db/types';
import { getParty, owed, type PartyType } from './parties';

export type StatementKind = 'opening' | 'invoice' | 'return' | 'purchase' | 'purchase_return' | 'receipt' | 'refund' | 'payment' | 'supplier_refund' | 'void';

export interface StatementItem {
  name: string;
  qtyMilli: number;
  unit: string;
  priceMinor: number;
  totalMinor: number;
}

export interface StatementRow {
  key: string;
  day: number;
  at: number;
  kind: StatementKind;
  number: string | null;
  docId: string;
  /** Amounts from the party's point of view in OUR books: debit raises what a customer owes / lowers what we owe a supplier. */
  debitMinor: number;
  creditMinor: number;
  /** Display balance after this row (owed: customer owes us / we owe supplier). */
  balanceMinor: number;
  /** Document total and paid-on-the-spot (sales/purchases), for the detailed view. */
  docTotalMinor?: number;
  paidNowMinor?: number;
  method?: string | null;
  note?: string | null;
  items?: StatementItem[];
}

export interface Statement {
  partyType: PartyType;
  party: { id: string; name: string; mobile: string | null; address: string | null };
  from: number;
  to: number;
  openingMinor: number;
  closingMinor: number;
  totalDebitMinor: number;
  totalCreditMinor: number;
  rows: StatementRow[];
}

/** Statement for [from, to] (business days, inclusive). */
export async function partyStatement(db: Db, partyType: PartyType, partyId: string, from: number, to: number, opts: { detailed?: boolean } = {}): Promise<Statement> {
  const p = await getParty(db, partyType, partyId);
  if (!p) throw new Error('not_found');
  const pc = and(eq(partyLedger.partyType, partyType), eq(partyLedger.partyId, partyId));
  const before = (await db.select({ b: sql<number>`coalesce(sum(debit_minor - credit_minor), 0)` }).from(partyLedger).where(and(pc, lt(partyLedger.businessDay, from))))[0];
  const openingLedger = Number(before?.b ?? 0);
  const ledger = await db.select().from(partyLedger).where(and(pc, gte(partyLedger.businessDay, from), lte(partyLedger.businessDay, to))).orderBy(asc(partyLedger.createdAt), asc(partyLedger.id));

  // Documents referenced by the ledger + cash-only documents of this party in range (net effect 0).
  const raw: Omit<StatementRow, 'balanceMinor'>[] = [];
  const seenDocs = new Set<string>();
  const salesIds = new Set<string>();
  const purchaseIds = new Set<string>();
  const voucherIds = new Set<string>();
  for (const l of ledger) {
    if (l.sourceType === 'sales_doc' || l.sourceType === 'sales_void') salesIds.add(l.sourceId);
    else if (l.sourceType === 'purchase_doc' || l.sourceType === 'purchase_void') purchaseIds.add(l.sourceId);
    else if (l.sourceType === 'voucher' || l.sourceType === 'voucher_void') voucherIds.add(l.sourceId);
  }
  const sDocs = partyType === 'C'
    ? await db.select().from(salesDocs).where(and(eq(salesDocs.customerId, partyId), inArray(salesDocs.type, ['INVOICE', 'RETURN']), inArray(salesDocs.status, ['POSTED', 'VOIDED']), gte(salesDocs.businessDay, from), lte(salesDocs.businessDay, to)))
    : [];
  const pDocs = partyType === 'S'
    ? await db.select().from(purchaseDocs).where(and(eq(purchaseDocs.supplierId, partyId), inArray(purchaseDocs.status, ['POSTED', 'VOIDED']), gte(purchaseDocs.businessDay, from), lte(purchaseDocs.businessDay, to)))
    : [];
  const extraS = salesIds.size ? await db.select().from(salesDocs).where(inArray(salesDocs.id, [...salesIds])) : [];
  const extraP = purchaseIds.size ? await db.select().from(purchaseDocs).where(inArray(purchaseDocs.id, [...purchaseIds])) : [];
  const vRows = voucherIds.size ? await db.select().from(vouchers).where(inArray(vouchers.id, [...voucherIds])) : [];
  const sById = new Map([...sDocs, ...extraS].map((d) => [d.id, d]));
  const pById = new Map([...pDocs, ...extraP].map((d) => [d.id, d]));
  const vById = new Map(vRows.map((v) => [v.id, v]));

  for (const l of ledger) {
    const base = { key: l.id, day: l.businessDay, at: l.createdAt, docId: l.sourceId, debitMinor: l.debitMinor, creditMinor: l.creditMinor };
    if (l.sourceType === 'sales_doc') {
      const d = sById.get(l.sourceId);
      seenDocs.add(l.sourceId);
      if (d?.type === 'INVOICE') raw.push({ ...base, kind: 'invoice', number: d.number, debitMinor: d.totalMinor, creditMinor: d.totalMinor - l.debitMinor + l.creditMinor, docTotalMinor: d.totalMinor, paidNowMinor: d.paidMinor });
      else raw.push({ ...base, kind: 'return', number: d?.number ?? null, docTotalMinor: d?.totalMinor, note: d?.note });
    } else if (l.sourceType === 'purchase_doc') {
      const d = pById.get(l.sourceId);
      seenDocs.add(l.sourceId);
      if (d?.type === 'PURCHASE') raw.push({ ...base, kind: 'purchase', number: d.number, creditMinor: d.totalMinor, debitMinor: d.totalMinor - l.creditMinor + l.debitMinor, docTotalMinor: d.totalMinor, paidNowMinor: d.paidMinor });
      else raw.push({ ...base, kind: 'purchase_return', number: d?.number ?? null, docTotalMinor: d?.totalMinor, note: d?.note });
    } else if (l.sourceType === 'sales_void' || l.sourceType === 'purchase_void' || l.sourceType === 'voucher_void') {
      const num = sById.get(l.sourceId)?.number ?? pById.get(l.sourceId)?.number ?? vById.get(l.sourceId)?.number ?? null;
      raw.push({ ...base, kind: 'void', number: num, note: sById.get(l.sourceId)?.voidReason ?? pById.get(l.sourceId)?.voidReason ?? vById.get(l.sourceId)?.voidReason ?? null });
    } else if (l.sourceType === 'voucher') {
      const v = vById.get(l.sourceId);
      const kind: StatementKind = v?.type === 'OPENING_BALANCE' ? 'opening' : v?.type === 'RECEIPT' ? 'receipt' : v?.type === 'CUSTOMER_REFUND' ? 'refund' : v?.type === 'PAYMENT' ? 'payment' : 'supplier_refund';
      raw.push({ ...base, kind, number: v?.number ?? null, method: v?.method, note: v?.note });
    }
  }
  // Fully paid documents (no ledger row) still belong on the customer's statement.
  for (const d of sDocs) {
    if (seenDocs.has(d.id)) continue;
    raw.push({ key: d.id, day: d.businessDay!, at: d.postedAt!, docId: d.id, kind: d.type === 'INVOICE' ? 'invoice' : 'return', number: d.number, debitMinor: d.type === 'INVOICE' ? d.totalMinor : d.totalMinor, creditMinor: d.totalMinor, docTotalMinor: d.totalMinor, paidNowMinor: d.paidMinor });
  }
  for (const d of pDocs) {
    if (seenDocs.has(d.id)) continue;
    raw.push({ key: d.id, day: d.businessDay!, at: d.postedAt!, docId: d.id, kind: d.type === 'PURCHASE' ? 'purchase' : 'purchase_return', number: d.number, debitMinor: d.totalMinor, creditMinor: d.totalMinor, docTotalMinor: d.totalMinor, paidNowMinor: d.paidMinor });
  }
  raw.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : 1));

  if (opts.detailed) {
    const sIds = raw.filter((r) => r.kind === 'invoice' || r.kind === 'return').map((r) => r.docId);
    const pIds = raw.filter((r) => r.kind === 'purchase' || r.kind === 'purchase_return').map((r) => r.docId);
    const sl = sIds.length ? await db.select().from(salesLines).where(inArray(salesLines.docId, sIds)).orderBy(asc(salesLines.lineNo)) : [];
    const pl = pIds.length ? await db.select().from(purchaseLines).where(inArray(purchaseLines.docId, pIds)).orderBy(asc(purchaseLines.lineNo)) : [];
    const items = new Map<string, StatementItem[]>();
    for (const l of sl) (items.get(l.docId) ?? items.set(l.docId, []).get(l.docId)!).push({ name: l.nameSnapshot, qtyMilli: l.qtyMilli, unit: l.unitNameSnapshot, priceMinor: l.unitPriceMinor, totalMinor: l.totalMinor });
    for (const l of pl) (items.get(l.docId) ?? items.set(l.docId, []).get(l.docId)!).push({ name: l.nameSnapshot, qtyMilli: l.qtyMilli, unit: l.unitNameSnapshot, priceMinor: l.unitCostMinor, totalMinor: l.totalMinor });
    for (const r of raw) r.items = items.get(r.docId);
  }

  let bal = openingLedger;
  const rows: StatementRow[] = raw.map((r) => {
    bal += r.debitMinor - r.creditMinor;
    return { ...r, balanceMinor: owed(partyType, bal) };
  });
  return {
    partyType,
    party: { id: p.id, name: p.name, mobile: p.mobile, address: p.address },
    from,
    to,
    openingMinor: owed(partyType, openingLedger),
    closingMinor: owed(partyType, bal),
    totalDebitMinor: rows.reduce((s, r) => s + r.debitMinor, 0),
    totalCreditMinor: rows.reduce((s, r) => s + r.creditMinor, 0),
    rows,
  };
}

/** Customers who owe money, with the age of the oldest unpaid amount (reminders / overdue list). */
export async function customersDue(db: Db, today: number, minDays = 0) {
  const owing = await db.select({ id: partyLedger.partyId }).from(partyLedger).where(eq(partyLedger.partyType, 'C')).groupBy(partyLedger.partyId).having(sql`sum(debit_minor - credit_minor) > 0`);
  const out: { id: string; balanceMinor: number; oldestDay: number; days: number }[] = [];
  for (const { id } of owing) {
    const rows = await db.select({ businessDay: partyLedger.businessDay, at: partyLedger.createdAt, debitMinor: partyLedger.debitMinor, creditMinor: partyLedger.creditMinor }).from(partyLedger).where(and(eq(partyLedger.partyType, 'C'), eq(partyLedger.partyId, id)));
    const oldest = oldestUnpaidDay(rows);
    if (oldest == null) continue;
    const days = daysBetween(oldest, today);
    if (days < minDays) continue;
    out.push({ id, balanceMinor: rows.reduce((s, r) => s + r.debitMinor - r.creditMinor, 0), oldestDay: oldest, days });
  }
  return out.sort((a, b) => b.days - a.days);
}

/** One customer's due status (same rule as customersDue) — null when they owe nothing. */
export async function partyDue(db: Db, id: string, today: number): Promise<{ balanceMinor: number; oldestDay: number; days: number } | null> {
  const rows = await db.select({ businessDay: partyLedger.businessDay, at: partyLedger.createdAt, debitMinor: partyLedger.debitMinor, creditMinor: partyLedger.creditMinor }).from(partyLedger).where(and(eq(partyLedger.partyType, 'C'), eq(partyLedger.partyId, id)));
  const balanceMinor = rows.reduce((s, r) => s + r.debitMinor - r.creditMinor, 0);
  if (balanceMinor <= 0) return null;
  const oldest = oldestUnpaidDay(rows);
  if (oldest == null) return null;
  return { balanceMinor, oldestDay: oldest, days: daysBetween(oldest, today) };
}
