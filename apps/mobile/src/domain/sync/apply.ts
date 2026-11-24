/**
 * Main phone: applies what the cashier phones sent (sales today), each exactly once, in each phone's order.
 * A sale is posted with the cashier phone's id, number, time, cashier, prices and offers (postSale imported); the
 * "applied" record is written in the same transaction. A sale that cannot be posted is NOT marked applied: it is
 * retried at every sync (the error is kept for the «موبايلات المحل» screen), so it is never lost.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { FeatureKey, PaymentInput, SaleDraft, SalesSettings } from './types';
import { salesDocs, syncApplied, users } from '../../db/schema';
import type { Db } from '../../db/types';
import { postSale, type ImportedSale } from '../sales/sales';
import { toSessionUser } from '../auth/users';

export interface SaleOp {
  docId: string;
  number: string;
  at: number;
  userId: string;
  approvedById: string | null;
  draft: SaleDraft;
  pays: PaymentInput[];
  settings: SalesSettings;
  offers?: ImportedSale['offers'];
}

export type ApplyResult = 'applied' | 'duplicate' | 'failed';

export async function recordFailure(db: Db, key: string, error: string, at = Date.now()) {
  await db
    .insert(syncApplied)
    .values({ key, docId: null, appliedAt: at, error: error.slice(0, 300) })
    .onConflictDoUpdate({ target: syncApplied.key, set: { error: error.slice(0, 300), appliedAt: at } });
}

export async function applyOp(
  db: Db,
  op: { deviceId: string; deviceCode: string; seq: number; kind: string; payload: unknown },
  env: { timezone: string; features: FeatureKey[]; now?: () => number },
): Promise<ApplyResult> {
  const key = `${op.deviceId}:${op.seq}`;
  if ((await db.select({ k: syncApplied.key }).from(syncApplied).where(and(eq(syncApplied.key, key), isNull(syncApplied.error))).limit(1))[0]) return 'duplicate';
  const at = env.now ? env.now() : Date.now();
  const done = (docId: string | null) => (tx: Db) =>
    tx.insert(syncApplied).values({ key, docId, appliedAt: at }).onConflictDoUpdate({ target: syncApplied.key, set: { docId, appliedAt: at, error: null } }).then(() => undefined);
  try {
    if (op.kind !== 'sale') throw new Error(`unknown op ${op.kind}`);
    const p = op.payload as SaleOp;
    // Already posted (a retry after a crash between posting and the answer): just record it.
    if ((await db.select({ id: salesDocs.id }).from(salesDocs).where(eq(salesDocs.id, p.docId)).limit(1))[0]) {
      await done(p.docId)(db);
      return 'duplicate';
    }
    const known = (await db.select({ id: users.id }).from(users).where(eq(users.id, p.userId)).limit(1))[0];
    if (!known) throw new Error('unknown_user');
    const user = await toSessionUser(db, p.userId);
    const approver = p.approvedById ? await toSessionUser(db, p.approvedById).catch(() => null) : null;
    await postSale(
      { db, user, device: { id: op.deviceId, code: op.deviceCode }, timezone: env.timezone, negativeStock: 'warn', features: env.features, settings: p.settings },
      p.draft,
      p.pays,
      { imported: { docId: p.docId, number: p.number, at: p.at, offers: p.offers, onPosted: done(p.docId) }, approvedBy: approver },
    );
    return 'applied';
  } catch (e) {
    await recordFailure(db, key, e instanceof Error ? e.message || e.name : String(e), at);
    return 'failed';
  }
}
