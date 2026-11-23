/**
 * Customers & suppliers (SPEC §5): one code path for both. Minimal form (name, mobile, address) plus
 * "more" (email, tax number, credit limit, price tier, notes). Soft delete only, and only at zero balance.
 * Balances: customers = Σ debit − Σ credit (they owe us when > 0); suppliers are shown as Σ credit − Σ debit
 * (we owe them when > 0). See `owed()`.
 */
import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { HybridLogicalClock, normalizeArabicForSearch, normalizePhone, uuidv7 } from '@daftarak/shared';
import { customers, partyBalances, partyLedger, suppliers } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite, assertWithinLimit } from '../licence/guard';
import { ftsQuery } from '../inventory/search';
import type { PartyCtx } from './customers';

export type PartyType = 'C' | 'S';

export class PartyError extends Error {
  constructor(public readonly code: 'name_required' | 'not_found' | 'has_balance' | 'mobile_taken' | 'mobile_invalid') {
    super(code);
    this.name = 'PartyError';
  }
}

export interface PartyInput {
  id?: string;
  name: string;
  mobile?: string | null;
  address?: string | null;
  email?: string | null;
  taxNumber?: string | null;
  creditLimitMinor?: number | null;
  priceTier?: 'retail' | 'wholesale';
  notes?: string | null;
}

let hlc: HybridLogicalClock | null = null;
const table = (t: PartyType) => (t === 'C' ? customers : suppliers);

/** Balance as the user reads it: what the customer owes us / what we owe the supplier. */
export function owed(type: PartyType, ledgerBalance: number): number {
  return type === 'C' ? ledgerBalance : -ledgerBalance;
}

export async function refreshPartySearch(tx: Db, type: PartyType, id: string) {
  const row = (await tx.select().from(table(type)).where(eq(table(type).id, id)).limit(1))[0];
  if (type === 'C') await tx.run(sql`DELETE FROM customers_fts WHERE customer_id = ${id}`);
  else await tx.run(sql`DELETE FROM suppliers_fts WHERE supplier_id = ${id}`);
  if (!row || row.deletedAt) return;
  const body = normalizeArabicForSearch([row.name, row.mobile, row.address].filter(Boolean).join(' '));
  if (type === 'C') await tx.run(sql`INSERT INTO customers_fts (customer_id, body) VALUES (${id}, ${body})`);
  else await tx.run(sql`INSERT INTO suppliers_fts (supplier_id, body) VALUES (${id}, ${body})`);
}

/** Checks that need no database: permission, licence, name, mobile. Returns the cleaned values. */
export function checkParty(ctx: PartyCtx, type: PartyType, input: PartyInput) {
  requirePermission(ctx.user, type === 'C' ? 'parties.manage' : 'purchases.manage');
  assertCanWrite();
  const name = input.name.trim();
  if (!name) throw new PartyError('name_required');
  const raw = input.mobile?.trim() ?? '';
  const mobile = raw ? (normalizePhone(raw) ?? normalizePhone(raw, 'EG')) : null;
  if (raw && !mobile) throw new PartyError('mobile_invalid');
  const values = {
    name,
    mobile,
    address: input.address?.trim() || null,
    email: input.email?.trim() || null,
    taxNumber: input.taxNumber?.trim() || null,
    notes: input.notes?.trim() || null,
    ...(type === 'C' ? { creditLimitMinor: input.creditLimitMinor ?? null, priceTier: input.priceTier ?? 'retail' } : {}),
  };
  return values;
}

/** Create or update a customer/supplier. Returns the id. */
export async function saveParty(ctx: PartyCtx, type: PartyType, input: PartyInput): Promise<string> {
  checkParty(ctx, type, input);
  return withTx(ctx.db, (tx) => savePartyTx(tx, ctx, type, input));
}

/** saveParty inside the caller's transaction (never starts its own). */
export async function savePartyTx(tx: Db, ctx: PartyCtx, type: PartyType, input: PartyInput): Promise<string> {
  const values = checkParty(ctx, type, input);
  const { name, mobile } = values;
  const t = ctx.now?.() ?? Date.now();
  const tbl = table(type);
  hlc ??= new HybridLogicalClock(ctx.device.code);
  if (mobile) {
    const dup = (await tx.select({ id: tbl.id }).from(tbl).where(and(eq(tbl.mobile, mobile), isNull(tbl.deletedAt))).limit(1))[0];
    if (dup && dup.id !== input.id) throw new PartyError('mobile_taken');
  }
  let id = input.id;
  if (id) {
    const before = (await tx.select().from(tbl).where(eq(tbl.id, id)).limit(1))[0];
    if (!before || before.deletedAt) throw new PartyError('not_found');
    await tx.update(tbl).set({ ...values, updatedAt: t, hlc: hlc.tick() } as never).where(eq(tbl.id, id));
    await appendAudit(tx, { action: 'party.update', entity: type === 'C' ? 'customers' : 'suppliers', entityId: id, before: { name: before.name, mobile: before.mobile }, after: { name, mobile }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  } else {
    const n = (await tx.select({ n: sql<number>`count(*)` }).from(tbl).where(isNull(tbl.deletedAt)))[0]?.n ?? 0;
    assertWithinLimit('parties', Number(n));
    id = uuidv7(t);
    await tx.insert(tbl).values({ id, ...values, createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: hlc.tick() } as never);
    await appendAudit(tx, { action: type === 'C' ? 'customer.create' : 'party.create', entity: type === 'C' ? 'customers' : 'suppliers', entityId: id, after: { name, mobile }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  }
  await refreshPartySearch(tx, type, id);
  return id;
}

/** Soft delete; refused while the balance is not zero (history stays intact). */
export async function deleteParty(ctx: PartyCtx, type: PartyType, id: string): Promise<void> {
  requirePermission(ctx.user, type === 'C' ? 'parties.manage' : 'purchases.manage');
  assertCanWrite();
  const t = ctx.now?.() ?? Date.now();
  const tbl = table(type);
  await withTx(ctx.db, async (tx) => {
    const bal = (await tx.select().from(partyBalances).where(and(eq(partyBalances.partyType, type), eq(partyBalances.partyId, id))).limit(1))[0];
    if (bal && bal.balanceMinor !== 0) throw new PartyError('has_balance');
    await tx.update(tbl).set({ deletedAt: t, updatedAt: t } as never).where(eq(tbl.id, id));
    await refreshPartySearch(tx, type, id);
    await appendAudit(tx, { action: 'party.delete', entity: type === 'C' ? 'customers' : 'suppliers', entityId: id, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  });
}

export interface PartyRow {
  id: string;
  name: string;
  mobile: string | null;
  address: string | null;
  priceTier: 'retail' | 'wholesale';
  creditLimitMinor: number | null;
  /** Ledger balance (debit − credit). Use owed() for display. */
  balanceMinor: number;
  lastActivityAt: number | null;
}

/** List with balances. filter: 'owing' = they owe us (C) / we owe them (S); 'credit' = the other way. */
type PartyQuery = { search?: string; filter?: 'all' | 'owing' | 'credit' };

function partyConds(type: PartyType, q: PartyQuery) {
  const tbl = table(type);
  const fts = ftsQuery(q.search ?? '');
  const ftsTable = type === 'C' ? sql`SELECT customer_id FROM customers_fts WHERE customers_fts MATCH ${fts}` : sql`SELECT supplier_id FROM suppliers_fts WHERE suppliers_fts MATCH ${fts}`;
  const bal = sql<number>`coalesce(${partyBalances.balanceMinor}, 0)`;
  const conds = [isNull(tbl.deletedAt)];
  if (fts) conds.push(sql`${tbl.id} IN (${ftsTable})`);
  const owingSign = type === 'C' ? 1 : -1;
  if (q.filter === 'owing') conds.push(owingSign > 0 ? gt(bal, 0) : lt(bal, 0));
  if (q.filter === 'credit') conds.push(owingSign > 0 ? lt(bal, 0) : gt(bal, 0));
  return { tbl, bal, conds, owingSign };
}

/** How many parties match (same search/filter as listParties) — one COUNT query. */
export async function countParties(db: Db, type: PartyType, q: PartyQuery = {}): Promise<number> {
  const { tbl, conds } = partyConds(type, q);
  const r = (await db
    .select({ n: sql<number>`count(*)` })
    .from(tbl)
    .leftJoin(partyBalances, and(eq(partyBalances.partyType, type), eq(partyBalances.partyId, tbl.id)))
    .where(and(...conds)))[0];
  return Number(r?.n ?? 0);
}

export async function listParties(db: Db, type: PartyType, q: PartyQuery & { sort?: 'name' | 'balance' | 'recent'; limit?: number; offset?: number } = {}): Promise<PartyRow[]> {
  const { tbl, bal, conds, owingSign } = partyConds(type, q);
  const order = q.sort === 'balance' ? (owingSign > 0 ? desc(bal) : asc(bal)) : q.sort === 'recent' ? desc(sql`coalesce(${partyBalances.lastActivityAt}, ${tbl.createdAt})`) : asc(tbl.name);
  const rows = await db
    .select({
      id: tbl.id,
      name: tbl.name,
      mobile: tbl.mobile,
      address: tbl.address,
      priceTier: type === 'C' ? customers.priceTier : sql<'retail'>`'retail'`,
      creditLimitMinor: type === 'C' ? customers.creditLimitMinor : sql<null>`null`,
      balanceMinor: bal,
      lastActivityAt: partyBalances.lastActivityAt,
    })
    .from(tbl)
    .leftJoin(partyBalances, and(eq(partyBalances.partyType, type), eq(partyBalances.partyId, tbl.id)))
    .where(and(...conds))
    .orderBy(order)
    .limit(q.limit ?? 200)
    .offset(q.offset ?? 0);
  return rows.map((r) => ({ ...r, balanceMinor: Number(r.balanceMinor), priceTier: (r.priceTier ?? 'retail') as 'retail' | 'wholesale', creditLimitMinor: r.creditLimitMinor ?? null }));
}

export async function getParty(db: Db, type: PartyType, id: string) {
  const row = (await db.select().from(table(type)).where(eq(table(type).id, id)).limit(1))[0];
  if (!row) return null;
  const b = (await db.select().from(partyBalances).where(and(eq(partyBalances.partyType, type), eq(partyBalances.partyId, id))).limit(1))[0];
  return { ...(row as typeof customers.$inferSelect), balanceMinor: b?.balanceMinor ?? 0, lastActivityAt: b?.lastActivityAt ?? null };
}

/** Totals for the list header: Σ owed to us (customers) / Σ we owe (suppliers), and count. */
export async function partyTotals(db: Db, type: PartyType): Promise<{ owedMinor: number; count: number }> {
  const sign = type === 'C' ? 1 : -1;
  const r = (await db
    .select({ owed: sql<number>`coalesce(sum(case when ${partyBalances.balanceMinor} * ${sign} > 0 then ${partyBalances.balanceMinor} * ${sign} else 0 end), 0)`, n: sql<number>`count(*)` })
    .from(partyBalances)
    .where(eq(partyBalances.partyType, type)))[0];
  return { owedMinor: Number(r?.owed ?? 0), count: Number(r?.n ?? 0) };
}

export async function partyLedgerRows(db: Db, type: PartyType, id: string) {
  return db.select().from(partyLedger).where(and(eq(partyLedger.partyType, type), eq(partyLedger.partyId, id))).orderBy(asc(partyLedger.createdAt), asc(partyLedger.id));
}
