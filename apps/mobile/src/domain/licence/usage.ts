/** How much of the plan's limits the shop is using (home "your plan" card). Same counts as the limit checks. */
import { and, count, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { PlanLimits } from '@daftarak/shared';
import type { Db } from '../../db/types';
import { customers, products, salesDocs, suppliers, users } from '../../db/schema';

export interface UsageRow {
  key: 'products' | 'parties' | 'invoices_month' | 'users';
  used: number;
  /** -1 = unlimited */
  limit: number;
}

export async function planUsage(db: Db, limits: PlanLimits, day: number): Promise<UsageRow[]> {
  const month = Math.floor(day / 100) * 100;
  const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const [p, c, s, inv, u] = await Promise.all([
    one(db.select({ n: count() }).from(products).where(isNull(products.deletedAt))),
    one(db.select({ n: count() }).from(customers).where(isNull(customers.deletedAt))),
    one(db.select({ n: count() }).from(suppliers).where(isNull(suppliers.deletedAt))),
    one(db.select({ n: count() }).from(salesDocs).where(and(eq(salesDocs.type, 'INVOICE'), inArray(salesDocs.status, ['POSTED', 'VOIDED']), gte(salesDocs.businessDay, month), lte(salesDocs.businessDay, month + 99)))),
    one(db.select({ n: count() }).from(users).where(and(eq(users.isActive, true), isNull(users.deletedAt)))),
  ]);
  return [
    { key: 'invoices_month', used: inv, limit: limits.invoices_month },
    { key: 'products', used: p, limit: limits.products },
    // The parties limit applies to customers and suppliers separately: show the fuller one.
    { key: 'parties', used: Math.max(c, s), limit: limits.parties },
    { key: 'users', used: u, limit: limits.users },
  ];
}

/** Share of the limit used, 0..1 (0 for unlimited). */
export const usedShare = (r: UsageRow) => (r.limit < 0 ? 0 : r.limit === 0 ? 1 : Math.min(1, r.used / r.limit));
