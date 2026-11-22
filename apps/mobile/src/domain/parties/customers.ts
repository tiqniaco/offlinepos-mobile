/**
 * Customers (minimal in Phase 3: quick add from the POS; full forms & statements in Phase 4)
 * and the party sub-ledger shared with suppliers.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { HybridLogicalClock, normalizeArabicForSearch, normalizePhone, uuidv7 } from '@daftarak/shared';
import { customers, partyBalances, partyLedger } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission, type SessionUser } from '../auth/users';
import { assertWithinLimit } from '../licence/guard';
import { ftsQuery } from '../inventory/search';

let hlc: HybridLogicalClock | null = null;

export interface PartyCtx {
  db: Db;
  user: SessionUser;
  device: { id: string; code: string };
  now?: () => number;
}

export async function refreshCustomerSearch(tx: Db, id: string) {
  await tx.run(sql`DELETE FROM customers_fts WHERE customer_id = ${id}`);
  const c = (await tx.select().from(customers).where(eq(customers.id, id)).limit(1))[0];
  if (!c || c.deletedAt) return;
  await tx.run(sql`INSERT INTO customers_fts (customer_id, body) VALUES (${id}, ${normalizeArabicForSearch([c.name, c.mobile].filter(Boolean).join(' '))})`);
}

export async function createCustomer(ctx: PartyCtx, input: { name: string; mobile?: string | null; priceTier?: 'retail' | 'wholesale' }): Promise<string> {
  requirePermission(ctx.user, 'parties.manage');
  const n = (await ctx.db.select({ n: sql<number>`count(*)` }).from(customers).where(isNull(customers.deletedAt)))[0]?.n ?? 0;
  assertWithinLimit('parties', Number(n));
  const name = input.name.trim();
  if (!name) throw new Error('name_required');
  const now = ctx.now?.() ?? Date.now();
  const id = uuidv7(now);
  const mobile = input.mobile ? (normalizePhone(input.mobile) ?? input.mobile.trim()) : null;
  await withTx(ctx.db, async (tx) => {
    await tx.insert(customers).values({ id, name, mobile, priceTier: input.priceTier ?? 'retail', createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: (hlc ??= new HybridLogicalClock(ctx.device.code)).tick() });
    await refreshCustomerSearch(tx, id);
    await appendAudit(tx, { action: 'customer.create', entity: 'customers', entityId: id, after: { name, mobile }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
  });
  return id;
}

export async function searchCustomers(db: Db, q: string, limit = 30) {
  const fts = ftsQuery(q);
  const where = fts
    ? and(isNull(customers.deletedAt), sql`${customers.id} IN (SELECT customer_id FROM customers_fts WHERE customers_fts MATCH ${fts})`)
    : isNull(customers.deletedAt);
  return db
    .select({ id: customers.id, name: customers.name, mobile: customers.mobile, priceTier: customers.priceTier, creditLimitMinor: customers.creditLimitMinor, balanceMinor: sql<number>`coalesce(${partyBalances.balanceMinor}, 0)` })
    .from(customers)
    .leftJoin(partyBalances, and(eq(partyBalances.partyType, 'C'), eq(partyBalances.partyId, customers.id)))
    .where(where)
    .orderBy(asc(customers.name))
    .limit(limit);
}

export async function getCustomer(db: Db, id: string) {
  return (await db.select().from(customers).where(eq(customers.id, id)).limit(1))[0] ?? null;
}

export async function partyBalance(db: Db, partyType: 'C' | 'S', partyId: string): Promise<number> {
  const r = (await db.select().from(partyBalances).where(and(eq(partyBalances.partyType, partyType), eq(partyBalances.partyId, partyId))).limit(1))[0];
  return r?.balanceMinor ?? 0;
}

/** Append to the sub-ledger and update the cached balance (inside the caller's transaction). */
export async function postPartyLedger(
  tx: Db,
  ctx: { user: { id: string }; device: { id: string } },
  e: { partyType: 'C' | 'S'; partyId: string; sourceType: string; sourceId: string; debitMinor: number; creditMinor: number; businessDay: number; at: number; dueDay?: number | null },
) {
  if (e.debitMinor === 0 && e.creditMinor === 0) return;
  await tx.insert(partyLedger).values({ id: uuidv7(e.at), createdAt: e.at, updatedAt: e.at, createdBy: ctx.user.id, deviceId: ctx.device.id, partyType: e.partyType, partyId: e.partyId, sourceType: e.sourceType, sourceId: e.sourceId, debitMinor: e.debitMinor, creditMinor: e.creditMinor, businessDay: e.businessDay, dueDay: e.dueDay ?? null });
  const delta = e.debitMinor - e.creditMinor;
  await tx
    .insert(partyBalances)
    .values({ partyType: e.partyType, partyId: e.partyId, balanceMinor: delta, lastActivityAt: e.at })
    .onConflictDoUpdate({ target: [partyBalances.partyType, partyBalances.partyId], set: { balanceMinor: sql`${partyBalances.balanceMinor} + ${delta}`, lastActivityAt: e.at } });
}

/** Σ ledger for a party (tests / statement reconciliation). */
export async function ledgerBalance(db: Db, partyType: 'C' | 'S', partyId: string): Promise<number> {
  const r = (await db.select({ b: sql<number>`coalesce(sum(debit_minor - credit_minor), 0)` }).from(partyLedger).where(and(eq(partyLedger.partyType, partyType), eq(partyLedger.partyId, partyId))))[0];
  return Number(r?.b ?? 0);
}
