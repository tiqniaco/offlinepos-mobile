/**
 * Money documents (سندات): customer receipts & refunds, supplier payments & refunds, expenses, cash in/out
 * of the drawer, and party opening balances. One transaction each: payment row → party ledger → journal →
 * hash chain → audit. Immutable once posted; mistakes are voided (Manager/Owner, same day or open shift).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { businessDay, HybridLogicalClock, uuidv7, type PaymentMethod } from '@daftarak/shared';
import { expenseCategories, journalEntries, journalLines, accounts, payments, vouchers, shifts } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission, type SessionUser } from '../auth/users';
import { assertCanWrite, assertFeature } from '../licence/guard';
import { nextDocNumber } from '../inventory/numbering';
import { appendChain, chainHead, voidPayload, voucherPayload } from '../integrity/chain';
import { METHOD_ACCOUNT, postJournal, type AccountKey, type JournalLineInput } from '../accounting/journal';
import { postPartyLedger } from '../parties/customers';
import { checkParty, getParty, savePartyTx, type PartyInput, type PartyType } from '../parties/parties';
import { shiftIdFor } from '../shifts/shifts';

export type VoucherType = (typeof vouchers.$inferSelect)['type'];

export interface VoucherCtx {
  db: Db;
  user: SessionUser;
  device: { id: string; code: string };
  timezone: string;
  requireShift?: boolean;
  now?: () => number;
}

export class VoucherError extends Error {
  constructor(public readonly code: 'invalid_amount' | 'party_required' | 'category_required' | 'invalid_method' | 'not_found' | 'not_voidable' | 'clock_behind' | 'reason_required') {
    super(code);
    this.name = 'VoucherError';
  }
}

export interface VoucherInput {
  type: VoucherType;
  amountMinor: number;
  method: PaymentMethod;
  label?: string | null;
  partyType?: PartyType | null;
  partyId?: string | null;
  categoryId?: string | null;
  /** OPENING_BALANCE: +1 normal side (customer owes us / we owe supplier), −1 the other way. */
  sign?: 1 | -1;
  note?: string | null;
}

/** Per type: who may post it, which party, number prefix, money direction and payment kind. */
const RULES: Record<VoucherType, { perm: Parameters<typeof requirePermission>[1]; party: PartyType | null; prefix: string; dir: 'IN' | 'OUT' | null; kind: (typeof payments.$inferSelect)['kind'] | null }> = {
  RECEIPT: { perm: 'parties.manage', party: 'C', prefix: 'RCV', dir: 'IN', kind: 'RECEIPT' },
  CUSTOMER_REFUND: { perm: 'parties.manage', party: 'C', prefix: 'CRF', dir: 'OUT', kind: 'REFUND' },
  PAYMENT: { perm: 'purchases.manage', party: 'S', prefix: 'PAY', dir: 'OUT', kind: 'SUPPLIER_PAYMENT' },
  SUPPLIER_REFUND: { perm: 'purchases.manage', party: 'S', prefix: 'SRF', dir: 'IN', kind: 'SUPPLIER_REFUND' },
  EXPENSE: { perm: 'expenses.manage', party: null, prefix: 'EXP', dir: 'OUT', kind: 'EXPENSE' },
  CASH_IN: { perm: 'shift.manage', party: null, prefix: 'CIN', dir: 'IN', kind: 'CASH_IN' },
  CASH_OUT: { perm: 'shift.manage', party: null, prefix: 'COUT', dir: 'OUT', kind: 'CASH_OUT' },
  OPENING_BALANCE: { perm: 'parties.manage', party: null, prefix: 'OPB', dir: null, kind: null },
};

/** Journal lines + ledger effect (debit, credit on the party ledger) for a voucher. */
function effects(v: { type: VoucherType; amountMinor: number; method: PaymentMethod; partyType: PartyType | null; partyId: string | null; sign: number }): { jl: JournalLineInput[]; ledger: { debit: number; credit: number } | null } {
  const a = v.amountMinor;
  const m = METHOD_ACCOUNT[v.method] as AccountKey;
  const P = (acct: AccountKey, side: 'debit' | 'credit'): JournalLineInput => ({ account: acct, [side]: a, partyType: v.partyType!, partyId: v.partyId });
  switch (v.type) {
    case 'RECEIPT':
      return { jl: [{ account: m, debit: a }, P('AR', 'credit')], ledger: { debit: 0, credit: a } };
    case 'CUSTOMER_REFUND':
      return { jl: [P('AR', 'debit'), { account: m, credit: a }], ledger: { debit: a, credit: 0 } };
    case 'PAYMENT':
      return { jl: [P('AP', 'debit'), { account: m, credit: a }], ledger: { debit: a, credit: 0 } };
    case 'SUPPLIER_REFUND':
      return { jl: [{ account: m, debit: a }, P('AP', 'credit')], ledger: { debit: 0, credit: a } };
    case 'EXPENSE':
      return { jl: [{ account: 'EXPENSES', debit: a }, { account: m, credit: a }], ledger: null };
    case 'CASH_IN':
      return { jl: [{ account: 'CASH', debit: a }, { account: 'OWNER', credit: a }], ledger: null };
    case 'CASH_OUT':
      return { jl: [{ account: 'OWNER', debit: a }, { account: 'CASH', credit: a }], ledger: null };
    case 'OPENING_BALANCE': {
      const ctrl: AccountKey = v.partyType === 'C' ? 'AR' : 'AP';
      // Customer +1: they owe us (AR debit). Supplier +1: we owe them (AP credit).
      const partyDebit = (v.partyType === 'C') === (v.sign > 0);
      return partyDebit
        ? { jl: [P(ctrl, 'debit'), { account: 'OPENING_EQUITY', credit: a }], ledger: { debit: a, credit: 0 } }
        : { jl: [{ account: 'OPENING_EQUITY', debit: a }, P(ctrl, 'credit')], ledger: { debit: 0, credit: a } };
    }
  }
}

/** Validation that needs no database (permission, amount, party, method). */
function checkVoucher(ctx: VoucherCtx, input: VoucherInput) {
  const rule = RULES[input.type];
  // Opening balances follow the party: suppliers are purchases' business, customers parties'.
  requirePermission(ctx.user, input.type === 'OPENING_BALANCE' ? (input.partyType === 'S' ? 'purchases.manage' : 'parties.manage') : rule.perm);
  assertCanWrite();
  if (input.type === 'EXPENSE' || input.type === 'CASH_IN' || input.type === 'CASH_OUT') assertFeature('expenses_shifts');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new VoucherError('invalid_amount');
  const partyType = input.type === 'OPENING_BALANCE' ? (input.partyType ?? null) : rule.party;
  if (partyType && !input.partyId) throw new VoucherError('party_required');
  if (input.type === 'OPENING_BALANCE' && !partyType) throw new VoucherError('party_required');
  if (input.type === 'EXPENSE' && !input.categoryId) throw new VoucherError('category_required');
  const method: PaymentMethod = input.type === 'OPENING_BALANCE' ? 'credit' : input.method;
  if (input.type !== 'OPENING_BALANCE' && method === 'credit') throw new VoucherError('invalid_method');
  if ((input.type === 'CASH_IN' || input.type === 'CASH_OUT') && method !== 'cash') throw new VoucherError('invalid_method');
  return { rule, partyType, method };
}

export async function postVoucher(ctx: VoucherCtx, input: VoucherInput): Promise<{ id: string; number: string }> {
  checkVoucher(ctx, input);
  return withTx(ctx.db, (tx) => postVoucherTx(tx, ctx, input));
}

/** Post inside the caller's transaction (validates again; never starts its own transaction). */
export async function postVoucherTx(tx: Db, ctx: VoucherCtx, input: VoucherInput): Promise<{ id: string; number: string }> {
  const { rule, partyType, method } = checkVoucher(ctx, input);
  const t = ctx.now?.() ?? Date.now();
  if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new VoucherError('clock_behind');
  const day = businessDay(t, ctx.timezone);
  const party = partyType && input.partyId ? await getParty(tx, partyType, input.partyId) : null;
  if (partyType && (!party || party.deletedAt)) throw new VoucherError('party_required');
  const cat = input.categoryId ? (await tx.select().from(expenseCategories).where(eq(expenseCategories.id, input.categoryId)).limit(1))[0] : null;
  if (input.type === 'EXPENSE' && !cat) throw new VoucherError('category_required');
  const shiftId = rule.dir && method === 'cash' ? await shiftIdFor(tx, ctx.device.id, !!ctx.requireShift) : await shiftIdFor(tx, ctx.device.id, false);
  const number = await nextDocNumber(tx, ctx.device, `VOUCHER_${input.type}`, rule.prefix);
  const id = uuidv7(t);
  const base = { createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id };
  const sign = input.sign ?? 1;
  await tx.insert(vouchers).values({
    id,
    ...base,
    type: input.type,
    status: 'POSTED',
    number,
    partyType,
    partyId: input.partyId ?? null,
    partyName: party?.name ?? null,
    categoryId: cat?.id ?? null,
    categoryName: cat?.name ?? null,
    method,
    label: input.label ?? null,
    amountMinor: input.amountMinor,
    sign,
    note: input.note?.trim() || null,
    businessDay: day,
    shiftId,
    postedAt: t,
  });
  if (rule.dir && rule.kind) {
    await tx.insert(payments).values({ id: uuidv7(t), ...base, kind: rule.kind, direction: rule.dir, method, label: input.label ?? null, amountMinor: input.amountMinor, partyType, partyId: input.partyId ?? null, docType: 'voucher', docId: id, shiftId, businessDay: day, postedAt: t });
  }
  const eff = effects({ type: input.type, amountMinor: input.amountMinor, method, partyType, partyId: input.partyId ?? null, sign });
  if (eff.ledger && partyType) await postPartyLedger(tx, ctx, { partyType, partyId: input.partyId!, sourceType: 'voucher', sourceId: id, debitMinor: eff.ledger.debit, creditMinor: eff.ledger.credit, businessDay: day, at: t });
  await postJournal(tx, ctx, { sourceType: 'voucher', sourceId: id, businessDay: day, memo: number, lines: eff.jl, at: t });
  const row = (await tx.select().from(vouchers).where(eq(vouchers.id, id)).limit(1))[0]!;
  const pays = await tx.select().from(payments).where(eq(payments.docId, id));
  const chain = await appendChain(tx, ctx.device.id, 'VOUCHER', id, t, () => voucherPayload(row, pays));
  await tx.run(sql`UPDATE vouchers SET hash = ${chain.hash}, prev_hash = ${chain.prevHash}, chain_seq = ${chain.seq} WHERE id = ${id} AND hash IS NULL`);
  await appendAudit(tx, { action: 'voucher.post', entity: 'vouchers', entityId: id, after: { type: input.type, number, amount: input.amountMinor, party: input.partyId ?? null }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  return { id, number };
}

/** New customer/supplier and its opening balance in ONE transaction (no orphan party, no duplicate on retry). */
export async function createPartyWithOpening(ctx: VoucherCtx, type: PartyType, input: PartyInput, opening: { amountMinor: number; sign: 1 | -1 } | null): Promise<string> {
  const openInput: VoucherInput | null = opening && opening.amountMinor ? { type: 'OPENING_BALANCE', partyType: type, partyId: 'pending', amountMinor: opening.amountMinor, method: 'credit', sign: opening.sign } : null;
  if (openInput) checkVoucher(ctx, openInput);
  checkParty(ctx, type, input);
  return withTx(ctx.db, async (tx) => {
    const id = await savePartyTx(tx, ctx, type, input);
    if (openInput) await postVoucherTx(tx, ctx, { ...openInput, partyId: id });
    return id;
  });
}

/** Void a voucher: mirror ledger + journal, flag the payment, chain a VOID entry. */
export async function voidVoucher(ctx: VoucherCtx, id: string, reason: string): Promise<void> {
  requirePermission(ctx.user, 'doc.void');
  assertCanWrite();
  if (!reason.trim()) throw new VoucherError('reason_required');
  await withTx(ctx.db, async (tx) => {
    const t = ctx.now?.() ?? Date.now();
    const v = (await tx.select().from(vouchers).where(eq(vouchers.id, id)).limit(1))[0];
    if (!v || v.status !== 'POSTED') throw new VoucherError('not_voidable');
    if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new VoucherError('clock_behind');
    await assertVoidWindow(tx, v.shiftId, v.businessDay, t, ctx.timezone);
    const day = businessDay(t, ctx.timezone);
    const eff = effects({ type: v.type, amountMinor: v.amountMinor, method: v.method, partyType: v.partyType, partyId: v.partyId, sign: v.sign });
    if (eff.ledger && v.partyType && v.partyId) await postPartyLedger(tx, ctx, { partyType: v.partyType, partyId: v.partyId, sourceType: 'voucher_void', sourceId: id, debitMinor: eff.ledger.credit, creditMinor: eff.ledger.debit, businessDay: day, at: t });
    await mirrorJournal(tx, ctx, 'voucher', id, 'voucher_void', day, t, `void ${v.number}`);
    await tx.update(payments).set({ voided: true }).where(eq(payments.docId, id));
    await tx.update(vouchers).set({ status: 'VOIDED', voidReason: reason.trim(), voidedBy: ctx.user.id, voidedAt: t, updatedAt: t }).where(eq(vouchers.id, id));
    await appendChain(tx, ctx.device.id, 'VOID', id, t, () => voidPayload({ docId: id, number: v.number, reason: reason.trim(), by: ctx.user.id, at: t }));
    await appendAudit(tx, { action: 'voucher.void', entity: 'vouchers', entityId: id, before: { status: 'POSTED', amount: v.amountMinor }, after: { status: 'VOIDED' }, reason, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  });
}

/** Void window (Q-05): while the document's shift is still open; without a shift, the same business day. */
export async function assertVoidWindow(tx: Db, shiftId: string | null, docDay: number | null, t: number, tz: string) {
  if (shiftId) {
    const s = (await tx.select({ status: shifts.status }).from(shifts).where(eq(shifts.id, shiftId)).limit(1))[0];
    if (s?.status !== 'OPEN') throw new VoucherError('not_voidable');
    return;
  }
  if (docDay !== businessDay(t, tz)) throw new VoucherError('not_voidable');
}

/** Post the exact mirror of a document's journal entry (debits ↔ credits). */
export async function mirrorJournal(tx: Db, ctx: { user: { id: string }; device: { id: string } }, sourceType: string, sourceId: string, newSourceType: string, day: number, t: number, memo: string) {
  const entry = (await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId))).limit(1))[0];
  if (!entry) return [];
  const jl = await tx
    .select({ key: accounts.systemKey, d: journalLines.debitMinor, c: journalLines.creditMinor, pt: journalLines.partyType, pid: journalLines.partyId })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entry.id));
  const lines = jl.map((x) => ({ account: x.key as AccountKey, debit: x.c, credit: x.d, ...(x.pt ? { partyType: x.pt as PartyType, partyId: x.pid } : {}) }));
  await postJournal(tx, ctx, { sourceType: newSourceType, sourceId, businessDay: day, memo, at: t, lines });
  return lines;
}

export async function getVoucher(db: Db, id: string) {
  return (await db.select().from(vouchers).where(eq(vouchers.id, id)).limit(1))[0] ?? null;
}

export async function listVouchers(db: Db, q: { types?: VoucherType[]; partyType?: PartyType; partyId?: string; from?: number; to?: number; categoryId?: string; limit?: number; offset?: number } = {}) {
  const c = [];
  if (q.types?.length) c.push(inArray(vouchers.type, q.types));
  if (q.partyId) c.push(eq(vouchers.partyId, q.partyId));
  if (q.partyType) c.push(eq(vouchers.partyType, q.partyType));
  if (q.from) c.push(gte(vouchers.businessDay, q.from));
  if (q.to) c.push(lte(vouchers.businessDay, q.to));
  if (q.categoryId) c.push(eq(vouchers.categoryId, q.categoryId));
  return db.select().from(vouchers).where(c.length ? and(...c) : undefined).orderBy(desc(vouchers.postedAt), desc(vouchers.id)).limit(q.limit ?? 100).offset(q.offset ?? 0);
}

/** Expense totals by category for a day range (expenses screen header). */
export async function expenseTotals(db: Db, from: number, to: number) {
  return db
    .select({ categoryId: vouchers.categoryId, name: vouchers.categoryName, total: sql<number>`sum(${vouchers.amountMinor})`, n: sql<number>`count(*)` })
    .from(vouchers)
    .where(and(eq(vouchers.type, 'EXPENSE'), eq(vouchers.status, 'POSTED'), gte(vouchers.businessDay, from), lte(vouchers.businessDay, to)))
    .groupBy(vouchers.categoryId, vouchers.categoryName)
    .orderBy(desc(sql`sum(${vouchers.amountMinor})`));
}

// ─────────────────────────── expense categories ───────────────────────────

let hlc: HybridLogicalClock | null = null;

export const DEFAULT_EXPENSE_CATEGORIES = ['إيجار', 'كهرباء ومياه', 'مرتبات', 'نقل ومواصلات', 'إنترنت وتليفون', 'صيانة', 'أدوات ونظافة', 'مصروفات أخرى'];

export async function listExpenseCategories(db: Db) {
  return db.select().from(expenseCategories).where(isNull(expenseCategories.deletedAt)).orderBy(asc(expenseCategories.name));
}

export async function ensureExpenseCategories(db: Db, device: { id: string; code: string }, now = Date.now()) {
  const n = (await db.select({ n: sql<number>`count(*)` }).from(expenseCategories))[0]?.n ?? 0;
  if (Number(n) > 0) return;
  hlc ??= new HybridLogicalClock(device.code);
  for (const name of DEFAULT_EXPENSE_CATEGORIES) await db.insert(expenseCategories).values({ id: uuidv7(now), name, createdAt: now, updatedAt: now, deviceId: device.id, hlc: hlc.tick() });
}

export async function saveExpenseCategory(ctx: VoucherCtx, input: { id?: string; name: string; color?: string | null }): Promise<string> {
  requirePermission(ctx.user, 'expenses.manage');
  assertCanWrite();
  const name = input.name.trim();
  if (!name) throw new VoucherError('category_required');
  const t = ctx.now?.() ?? Date.now();
  hlc ??= new HybridLogicalClock(ctx.device.code);
  return withTx(ctx.db, async (tx) => {
    let id = input.id;
    if (id) await tx.update(expenseCategories).set({ name, color: input.color ?? null, updatedAt: t, hlc: hlc!.tick() }).where(eq(expenseCategories.id, id));
    else {
      id = uuidv7(t);
      await tx.insert(expenseCategories).values({ id, name, color: input.color ?? null, createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: hlc!.tick() });
    }
    await appendAudit(tx, { action: 'expense_category.change', entity: 'expense_categories', entityId: id, after: { name }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return id;
  });
}

export async function deleteExpenseCategory(ctx: VoucherCtx, id: string): Promise<void> {
  requirePermission(ctx.user, 'expenses.manage');
  assertCanWrite();
  const t = ctx.now?.() ?? Date.now();
  await withTx(ctx.db, async (tx) => {
    await tx.update(expenseCategories).set({ deletedAt: t, updatedAt: t }).where(eq(expenseCategories.id, id));
    await appendAudit(tx, { action: 'expense_category.change', entity: 'expense_categories', entityId: id, after: { deleted: true }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  });
}
