/**
 * Global search (one box for everything): products (name/barcode via FTS), customers, suppliers, sales invoices,
 * purchases and vouchers by number or name. Few rows per group — the screen shows "see all" per group.
 */
import { and, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { normalizeDigits } from '@daftarak/shared';
import { customers, purchaseDocs, salesDocs, suppliers, partyBalances, vouchers } from '../../db/schema';
import type { Db } from '../../db/types';
import { findByBarcode, listProducts } from '../inventory/products';
import { listParties } from '../parties/parties';

export interface SearchResults {
  products: { id: string; name: string; priceMinor: number; qtyMilli: number; unit: string }[];
  customers: { id: string; name: string; mobile: string | null; balanceMinor: number }[];
  suppliers: { id: string; name: string; mobile: string | null; balanceMinor: number }[];
  invoices: { id: string; number: string | null; name: string | null; totalMinor: number; type: string; status: string; postedAt: number | null }[];
  purchases: { id: string; number: string | null; name: string | null; totalMinor: number; type: string; status: string }[];
  vouchers: { id: string; number: string; name: string | null; amountMinor: number; type: string; status: string }[];
}

/**
 * `permissions` (the signed-in user's) hides what the user may not open: purchases & suppliers need purchases.manage,
 * expense vouchers need expenses.manage and the other vouchers parties.manage. Omitted → no filtering (tests/tools).
 */
export async function searchAll(db: Db, raw: string, limit = 5, permissions?: readonly string[]): Promise<SearchResults> {
  const q = normalizeDigits(raw).trim();
  const empty: SearchResults = { products: [], customers: [], suppliers: [], invoices: [], purchases: [], vouchers: [] };
  if (!q) return empty;
  const can = (p: string) => !permissions || permissions.includes(p);
  const canPurchases = can('purchases.manage');
  const canParties = can('parties.manage');
  const canExpenses = can('expenses.manage');
  const like_ = `%${q}%`;
  const none = <T,>(): Promise<T[]> => Promise.resolve([]);
  const [prods, byCode, cs, ss, inv, pur, vs] = await Promise.all([
    listProducts(db, { search: q, limit }),
    /^\d{6,}$/.test(q) ? findByBarcode(db, q) : Promise.resolve(null),
    listParties(db, 'C', { search: q, limit }),
    canPurchases ? listParties(db, 'S', { search: q, limit }) : none<Awaited<ReturnType<typeof listParties>>[number]>(),
    db
      .select({ id: salesDocs.id, number: salesDocs.number, name: salesDocs.customerName, totalMinor: salesDocs.totalMinor, type: salesDocs.type, status: salesDocs.status, postedAt: salesDocs.postedAt })
      .from(salesDocs)
      .where(and(inArray(salesDocs.status, ['POSTED', 'VOIDED']), or(like(salesDocs.number, like_), like(salesDocs.customerName, like_))))
      .orderBy(desc(salesDocs.postedAt))
      .limit(limit),
    !canPurchases
      ? none<SearchResults['purchases'][number]>()
      : db
        .select({ id: purchaseDocs.id, number: purchaseDocs.number, name: purchaseDocs.supplierName, totalMinor: purchaseDocs.totalMinor, type: purchaseDocs.type, status: purchaseDocs.status })
        .from(purchaseDocs)
        .where(and(inArray(purchaseDocs.status, ['POSTED', 'VOIDED']), or(like(purchaseDocs.number, like_), like(purchaseDocs.supplierName, like_), like(purchaseDocs.supplierRef, like_))))
        .orderBy(desc(purchaseDocs.postedAt))
        .limit(limit),
    !canParties && !canExpenses
      ? none<SearchResults['vouchers'][number]>()
      : db
        .select({ id: vouchers.id, number: vouchers.number, name: sql<string | null>`coalesce(${vouchers.partyName}, ${vouchers.categoryName})`, amountMinor: vouchers.amountMinor, type: vouchers.type, status: vouchers.status })
        .from(vouchers)
        .where(or(like(vouchers.number, like_), like(vouchers.partyName, like_), like(vouchers.note, like_)))
        .orderBy(desc(vouchers.postedAt))
        .limit(limit),
  ]);
  const products = prods.map((p) => ({ id: p.id, name: p.variantLabel ? `${p.name} · ${p.variantLabel}` : p.name, priceMinor: p.retailPriceMinor, qtyMilli: p.qtyMilli, unit: p.unitName }));
  if (byCode && !products.some((p) => p.id === byCode.productId)) {
    const one = (await listProducts(db, { limit: 2000 })).find((p) => p.id === byCode.productId);
    if (one) products.unshift({ id: one.id, name: one.name, priceMinor: one.retailPriceMinor, qtyMilli: one.qtyMilli, unit: one.unitName });
  }
  // Phone numbers: stored in international form (2010…/9665…), typed locally (010…/05…) → match the digits after the 0.
  if (/^\d{4,}$/.test(q)) {
    const tail = `%${q.replace(/^0+/, '')}%`;
    for (const [tbl, type, list] of [[customers, 'C', cs], [suppliers, 'S', ss]] as const) {
      if (type === 'S' && !canPurchases) continue;
      const extra = await db
        .select({ id: tbl.id, name: tbl.name, mobile: tbl.mobile, balanceMinor: sql<number>`coalesce(${partyBalances.balanceMinor}, 0)` })
        .from(tbl)
        .leftJoin(partyBalances, and(eq(partyBalances.partyType, type), eq(partyBalances.partyId, tbl.id)))
        .where(and(isNull(tbl.deletedAt), like(tbl.mobile, tail)))
        .limit(limit);
      for (const e of extra) if (!list.some((x) => x.id === e.id)) (list as { id: string }[]).push({ ...e, balanceMinor: Number(e.balanceMinor) } as never);
    }
  }
  return {
    products,
    customers: cs.map((c) => ({ id: c.id, name: c.name, mobile: c.mobile, balanceMinor: c.balanceMinor })),
    suppliers: ss.map((s) => ({ id: s.id, name: s.name, mobile: s.mobile, balanceMinor: -s.balanceMinor })),
    invoices: inv,
    purchases: pur,
    vouchers: vs.filter((v) => (v.type === 'EXPENSE' ? canExpenses : canParties)),
  };
}
