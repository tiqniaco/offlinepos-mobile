/** What the morning summary says (pure DB reads; scheduling lives in features/notify). */
import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { addDays } from '@daftarak/shared';
import { partyBalances, products, purchaseDocs, stockLevels } from '../../db/schema';
import type { Db } from '../../db/types';
import { customersDue } from '../parties/statement';

export interface Reminders {
  lowStock: number;
  outOfStock: number;
  lateCustomers: number;
  lateAmountMinor: number;
  /** Supplier invoices due within 2 days (or overdue) and still unpaid on the supplier's account. */
  supplierDue: number;
  supplierDueMinor: number;
}

export async function computeReminders(db: Db, today: number, lateDays = 30): Promise<Reminders> {
  const low = (await db
    .select({ low: sql<number>`sum(CASE WHEN coalesce(${stockLevels.qtyMilli}, 0) > 0 AND coalesce(${stockLevels.qtyMilli}, 0) <= ${products.lowStockMilli} THEN 1 ELSE 0 END)`, out: sql<number>`sum(CASE WHEN coalesce(${stockLevels.qtyMilli}, 0) <= 0 THEN 1 ELSE 0 END)` })
    .from(products)
    .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
    .where(and(isNull(products.deletedAt), eq(products.trackStock, true), isNotNull(products.lowStockMilli))))[0];
  const due = await customersDue(db, today, lateDays);
  // Suppliers we still owe, with a purchase due by the day after tomorrow.
  const sup = (await db
    .select({ n: sql<number>`count(DISTINCT ${purchaseDocs.supplierId})`, amt: sql<number>`coalesce(sum(DISTINCT -${partyBalances.balanceMinor}), 0)` })
    .from(purchaseDocs)
    .innerJoin(partyBalances, and(eq(partyBalances.partyType, 'S'), eq(partyBalances.partyId, purchaseDocs.supplierId)))
    .where(and(eq(purchaseDocs.status, 'POSTED'), eq(purchaseDocs.type, 'PURCHASE'), isNotNull(purchaseDocs.dueDay), lte(purchaseDocs.dueDay, addDays(today, 2)), gt(sql`-${partyBalances.balanceMinor}`, 0))))[0];
  return {
    lowStock: Number(low?.low ?? 0),
    outOfStock: Number(low?.out ?? 0),
    lateCustomers: due.length,
    lateAmountMinor: due.reduce((s, d) => s + d.balanceMinor, 0),
    supplierDue: Number(sup?.n ?? 0),
    supplierDueMinor: Number(sup?.amt ?? 0),
  };
}

/** Lines of the morning notification (empty = nothing worth a notification). */
export function summaryLines(r: Reminders, t: (k: string, o?: Record<string, unknown>) => string, fmt: (minor: number) => string): string[] {
  const out: string[] = [];
  if (r.lateCustomers) out.push(t('notify.late', { n: r.lateCustomers, amount: fmt(r.lateAmountMinor) }));
  if (r.supplierDue) out.push(t('notify.supplierDue', { n: r.supplierDue, amount: fmt(r.supplierDueMinor) }));
  if (r.outOfStock) out.push(t('notify.out', { n: r.outOfStock }));
  if (r.lowStock) out.push(t('notify.low', { n: r.lowStock }));
  return out;
}
