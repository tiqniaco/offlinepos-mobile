/**
 * Main phone: applies what the cashier phones sent (sales today), each exactly once, in each phone's order.
 * A sale is posted with the cashier phone's id, number, time, cashier and prices (domain/sales postSale imported).
 */
import { eq } from 'drizzle-orm';
import type { FeatureKey, PaymentInput, SaleDraft, SalesSettings } from './types';
import { syncApplied, users } from '../../db/schema';
import type { Db } from '../../db/types';
import { postSale } from '../sales/sales';
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
}

export type ApplyResult = 'applied' | 'duplicate' | 'failed';

export async function applyOp(
  db: Db,
  op: { deviceId: string; deviceCode: string; seq: number; kind: string; payload: unknown },
  env: { timezone: string; features: FeatureKey[]; now?: () => number },
): Promise<ApplyResult> {
  const key = `${op.deviceId}:${op.seq}`;
  if ((await db.select({ k: syncApplied.key }).from(syncApplied).where(eq(syncApplied.key, key)).limit(1))[0]) return 'duplicate';
  const at = env.now ? env.now() : Date.now();
  try {
    if (op.kind !== 'sale') throw new Error(`unknown op ${op.kind}`);
    const p = op.payload as SaleOp;
    // The same sale arriving again (retry after a lost answer): already posted.
    const existing = await db.select({ id: syncApplied.key }).from(syncApplied).where(eq(syncApplied.docId, p.docId)).limit(1);
    if (existing[0]) {
      await db.insert(syncApplied).values({ key, docId: p.docId, appliedAt: at });
      return 'duplicate';
    }
    const known = (await db.select({ id: users.id }).from(users).where(eq(users.id, p.userId)).limit(1))[0];
    const user = known ? await toSessionUser(db, p.userId) : null;
    if (!user) throw new Error('unknown_user');
    const approver = p.approvedById ? await toSessionUser(db, p.approvedById).catch(() => null) : null;
    await postSale(
      { db, user, device: { id: op.deviceId, code: op.deviceCode }, timezone: env.timezone, negativeStock: 'warn', features: env.features, settings: p.settings },
      p.draft,
      p.pays,
      { imported: { docId: p.docId, number: p.number, at: p.at }, approvedBy: approver },
    );
    await db.insert(syncApplied).values({ key, docId: p.docId, appliedAt: at });
    return 'applied';
  } catch (e) {
    await db.insert(syncApplied).values({ key, docId: null, appliedAt: at, error: e instanceof Error ? e.message.slice(0, 300) : String(e) }).onConflictDoNothing();
    return 'failed';
  }
}
