/**
 * Cash shifts (الورديات, SPEC §5 Expenses & cash). One open shift per phone. Every money movement posted
 * while a shift is open carries its id. Close: expected cash = opening float + cash in − cash out;
 * the counted difference is posted to "Cash over/short" and the closed shift joins the hash chain.
 */
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { businessDay, uuidv7 } from '@daftarak/shared';
import { payments, salesDocs, shifts } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission, type SessionUser } from '../auth/users';
import { assertCanWrite, assertFeature } from '../licence/guard';
import { nextDocNumber } from '../inventory/numbering';
import { appendChain, chainHead, shiftPayload } from '../integrity/chain';
import { postJournal } from '../accounting/journal';

export interface ShiftCtx {
  db: Db;
  user: SessionUser;
  device: { id: string; code: string };
  timezone: string;
  now?: () => number;
}

export class ShiftError extends Error {
  constructor(public readonly code: 'shift_open' | 'no_shift' | 'shift_required' | 'invalid_amount' | 'not_yours' | 'clock_behind') {
    super(code);
    this.name = 'ShiftError';
  }
}

const nowOf = (c: { now?: () => number }) => (c.now ? c.now() : Date.now());

export async function currentShift(db: Db, deviceId: string) {
  return (await db.select().from(shifts).where(and(eq(shifts.deviceId, deviceId), eq(shifts.status, 'OPEN'))).limit(1))[0] ?? null;
}

/** Shift id to stamp on a new money document; throws when shifts are required and none is open. */
export async function shiftIdFor(tx: Db, deviceId: string, required = false): Promise<string | null> {
  const s = await currentShift(tx, deviceId);
  if (!s && required) throw new ShiftError('shift_required');
  return s?.id ?? null;
}

export async function openShift(ctx: ShiftCtx, openingFloatMinor: number, note?: string | null): Promise<string> {
  requirePermission(ctx.user, 'sales.create');
  assertFeature('expenses_shifts');
  if (!Number.isSafeInteger(openingFloatMinor) || openingFloatMinor < 0) throw new ShiftError('invalid_amount');
  return withTx(ctx.db, async (tx) => {
    if (await currentShift(tx, ctx.device.id)) throw new ShiftError('shift_open');
    const t = nowOf(ctx);
    const id = uuidv7(t);
    const number = await nextDocNumber(tx, ctx.device, 'SHIFT', 'SHF');
    await tx.insert(shifts).values({ id, createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id, number, status: 'OPEN', userId: ctx.user.id, userName: ctx.user.name, openedAt: t, openingFloatMinor, note: note ?? null, businessDay: businessDay(t, ctx.timezone) });
    await appendAudit(tx, { action: 'shift.open', entity: 'shifts', entityId: id, after: { number, float: openingFloatMinor }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return id;
  });
}

export interface ShiftSummary {
  openingFloatMinor: number;
  /** Cash in/out by payment kind (SALE, REFUND, RECEIPT, EXPENSE, …). */
  cashIn: Record<string, number>;
  cashOut: Record<string, number>;
  /** All methods, net of refunds (sales view). */
  byMethod: Record<string, number>;
  salesCount: number;
  salesTotalMinor: number;
  returnsTotalMinor: number;
  expectedCashMinor: number;
}

export async function shiftSummary(db: Db, shiftId: string): Promise<ShiftSummary> {
  const s = (await db.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1))[0];
  if (!s) throw new ShiftError('no_shift');
  const rows = await db
    .select({ kind: payments.kind, dir: payments.direction, method: payments.method, amount: sql<number>`sum(${payments.amountMinor})` })
    .from(payments)
    .where(and(eq(payments.shiftId, shiftId), eq(payments.voided, false)))
    .groupBy(payments.kind, payments.direction, payments.method);
  const cashIn: Record<string, number> = {};
  const cashOut: Record<string, number> = {};
  const byMethod: Record<string, number> = {};
  for (const r of rows) {
    const a = Number(r.amount);
    if (r.method === 'cash') (r.dir === 'IN' ? cashIn : cashOut)[r.kind] = ((r.dir === 'IN' ? cashIn : cashOut)[r.kind] ?? 0) + a;
    if (r.kind === 'SALE' || r.kind === 'REFUND') byMethod[r.method] = (byMethod[r.method] ?? 0) + (r.dir === 'IN' ? a : -a);
  }
  const docs = await db
    .select({ type: salesDocs.type, n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${salesDocs.totalMinor}), 0)` })
    .from(salesDocs)
    .where(and(eq(salesDocs.shiftId, shiftId), eq(salesDocs.status, 'POSTED')))
    .groupBy(salesDocs.type);
  const inv = docs.find((d) => d.type === 'INVOICE');
  const ret = docs.find((d) => d.type === 'RETURN');
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    openingFloatMinor: s.openingFloatMinor,
    cashIn,
    cashOut,
    byMethod,
    salesCount: Number(inv?.n ?? 0),
    salesTotalMinor: Number(inv?.total ?? 0),
    returnsTotalMinor: Number(ret?.total ?? 0),
    expectedCashMinor: s.openingFloatMinor + sum(cashIn) - sum(cashOut),
  };
}

/** Close the shift with the counted cash. Only the shift owner or a user with shift.manage. */
export async function closeShift(ctx: ShiftCtx, countedCashMinor: number, note?: string | null): Promise<{ differenceMinor: number; expectedCashMinor: number }> {
  assertCanWrite();
  if (!Number.isSafeInteger(countedCashMinor) || countedCashMinor < 0) throw new ShiftError('invalid_amount');
  return withTx(ctx.db, async (tx) => {
    const s = await currentShift(tx, ctx.device.id);
    if (!s) throw new ShiftError('no_shift');
    if (s.userId !== ctx.user.id) requirePermission(ctx.user, 'shift.manage');
    const t = nowOf(ctx);
    if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new ShiftError('clock_behind');
    const day = businessDay(t, ctx.timezone);
    const sum = await shiftSummary(tx, s.id);
    const diff = countedCashMinor - sum.expectedCashMinor;
    if (diff !== 0) {
      await postJournal(tx, { user: ctx.user, device: ctx.device }, {
        sourceType: 'shift',
        sourceId: s.id,
        businessDay: day,
        memo: `${s.number} over/short`,
        at: t,
        lines: diff > 0 ? [{ account: 'CASH', debit: diff }, { account: 'CASH_OVER_SHORT', credit: diff }] : [{ account: 'CASH_OVER_SHORT', debit: -diff }, { account: 'CASH', credit: -diff }],
      });
    }
    await tx
      .update(shifts)
      .set({ status: 'CLOSED', closedAt: t, closedBy: ctx.user.id, expectedCashMinor: sum.expectedCashMinor, countedCashMinor, differenceMinor: diff, summaryJson: JSON.stringify(sum), note: note ?? s.note, updatedAt: t })
      .where(eq(shifts.id, s.id));
    const closed = (await tx.select().from(shifts).where(eq(shifts.id, s.id)).limit(1))[0]!;
    const chain = await appendChain(tx, ctx.device.id, 'SHIFT', s.id, t, () => shiftPayload(closed));
    await tx.update(shifts).set({ hash: chain.hash, prevHash: chain.prevHash, chainSeq: chain.seq }).where(eq(shifts.id, s.id));
    await appendAudit(tx, { action: 'shift.close', entity: 'shifts', entityId: s.id, after: { expected: sum.expectedCashMinor, counted: countedCashMinor, diff }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return { differenceMinor: diff, expectedCashMinor: sum.expectedCashMinor };
  });
}

export async function listShifts(db: Db, limit = 50, range?: { from: number; to: number } | null) {
  const where = range ? and(gte(shifts.businessDay, range.from), lte(shifts.businessDay, range.to)) : undefined;
  return db.select().from(shifts).where(where).orderBy(desc(shifts.openedAt)).limit(limit);
}

export async function getShift(db: Db, id: string) {
  return (await db.select().from(shifts).where(eq(shifts.id, id)).limit(1))[0] ?? null;
}
