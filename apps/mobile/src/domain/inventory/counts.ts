/**
 * Stock count report (تقرير الجرد): every count — open, posted or discarded — with its scope, who did it, how
 * many items, and the money impact of the differences (shortage / surplus at cost). Open/discarded counts value
 * the difference at today's average cost; posted counts use the cost that was actually posted.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { categories, inventoryDocs, inventoryLines, products, stockLevels, units, users } from '../../db/schema';
import type { Db } from '../../db/types';
import { scopeCategoryId, uncountedInScope } from './adjust';

export type CountStatus = 'DRAFT' | 'POSTED' | 'DISCARDED';

export interface CountSummary {
  id: string;
  status: CountStatus;
  number: string | null;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  createdAt: number;
  postedAt: number | null;
  /** Last scan/edit (open counts) — "اتحفظ" time. */
  updatedAt: number;
  userName: string | null;
  items: number;
  shortItems: number;
  surplusItems: number;
  /** Positive amounts. */
  shortageMinor: number;
  surplusMinor: number;
  /** surplus − shortage. */
  netMinor: number;
}

export interface CountReportLine {
  productId: string;
  name: string;
  variantLabel: string | null;
  unitName: string;
  expectedMilli: number;
  countedMilli: number;
  diffMilli: number;
  unitCostMinor: number;
  /** Signed: − shortage, + surplus. */
  valueMinor: number;
  kind: 'short' | 'surplus' | 'match';
}

/** Same rounding as SQLite round() (half away from zero), so list totals = sum of report lines. */
export const diffValue = (diffMilli: number, unitCostMinor: number) => Math.sign(diffMilli * unitCostMinor) * Math.round(Math.abs(diffMilli * unitCostMinor) / 1000);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const all = <T>(db: Db, q: ReturnType<typeof sql>) => db.all(q) as unknown as Promise<T[]>;
const n = (v: unknown) => Number(v ?? 0);

/** All counts, newest first (the open one on top). */
export async function listCounts(db: Db, opts: { limit?: number } = {}): Promise<CountSummary[]> {
  const docs = await db
    .select({ d: inventoryDocs, userName: users.name, categoryName: categories.name })
    .from(inventoryDocs)
    .leftJoin(users, eq(users.id, inventoryDocs.createdBy))
    .leftJoin(categories, sql`${categories.id} = substr(${inventoryDocs.reason}, 5) AND ${inventoryDocs.reason} LIKE 'cat:%'`)
    .where(eq(inventoryDocs.type, 'COUNT'))
    .orderBy(sql`CASE ${inventoryDocs.status} WHEN 'DRAFT' THEN 0 ELSE 1 END`, sql`coalesce(${inventoryDocs.postedAt}, ${inventoryDocs.updatedAt}) DESC`)
    .limit(opts.limit ?? 200);
  if (!docs.length) return [];
  const agg = await all<{ docId: string; items: number; shortItems: number; surplusItems: number; shortage: number; surplus: number }>(
    db,
    sql`
    WITH lv AS (
      SELECT l.doc_id AS docId,
        CASE WHEN d.status = 'POSTED' THEN l.delta_milli ELSE coalesce(l.counted_milli, 0) - coalesce(l.expected_milli, s.qty_milli, 0) END AS delta,
        CASE WHEN d.status = 'POSTED' THEN coalesce(l.unit_cost_minor, 0) ELSE coalesce(nullif(s.avg_cost_minor, 0), p.cost_minor, 0) END AS cost
      FROM inventory_lines l
      JOIN inventory_docs d ON d.id = l.doc_id
      JOIN products p ON p.id = l.product_id
      LEFT JOIN stock_levels s ON s.product_id = l.product_id AND s.warehouse_id = d.warehouse_id
      WHERE d.type = 'COUNT'
    )
    SELECT docId, count(*) AS items,
      sum(CASE WHEN delta < 0 THEN 1 ELSE 0 END) AS shortItems,
      sum(CASE WHEN delta > 0 THEN 1 ELSE 0 END) AS surplusItems,
      sum(CASE WHEN delta < 0 THEN CAST(round(-delta * cost / 1000.0) AS INTEGER) ELSE 0 END) AS shortage,
      sum(CASE WHEN delta > 0 THEN CAST(round(delta * cost / 1000.0) AS INTEGER) ELSE 0 END) AS surplus
    FROM lv GROUP BY docId`,
  );
  const by = new Map(agg.map((a) => [a.docId, a]));
  return docs.map(({ d, userName, categoryName }) => {
    const a = by.get(d.id);
    const shortageMinor = n(a?.shortage);
    const surplusMinor = n(a?.surplus);
    return {
      id: d.id,
      status: d.status,
      number: d.number,
      note: d.note,
      categoryId: scopeCategoryId(d.reason),
      categoryName: categoryName ?? null,
      createdAt: d.createdAt,
      postedAt: d.postedAt,
      updatedAt: d.updatedAt,
      userName: userName ?? null,
      items: n(a?.items),
      shortItems: n(a?.shortItems),
      surplusItems: n(a?.surplusItems),
      shortageMinor,
      surplusMinor,
      netMinor: surplusMinor - shortageMinor,
    };
  });
}

/** One count with its lines, biggest money impact first. */
export async function getCountReport(db: Db, docId: string): Promise<{ count: CountSummary; lines: CountReportLine[] } | null> {
  const count = (await listCounts(db, { limit: 10_000 })).find((c) => c.id === docId);
  if (!count) return null;
  const posted = count.status === 'POSTED';
  const rows = await db
    .select({
      productId: inventoryLines.productId,
      name: products.name,
      variantLabel: products.variantLabel,
      unitName: units.nameAr,
      expectedMilli: inventoryLines.expectedMilli,
      countedMilli: inventoryLines.countedMilli,
      deltaMilli: inventoryLines.deltaMilli,
      lineCost: inventoryLines.unitCostMinor,
      currentMilli: stockLevels.qtyMilli,
      avgCostMinor: stockLevels.avgCostMinor,
      costMinor: products.costMinor,
    })
    .from(inventoryLines)
    .innerJoin(inventoryDocs, eq(inventoryDocs.id, inventoryLines.docId))
    .innerJoin(products, eq(products.id, inventoryLines.productId))
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .leftJoin(stockLevels, and(eq(stockLevels.productId, inventoryLines.productId), eq(stockLevels.warehouseId, inventoryDocs.warehouseId)))
    .where(eq(inventoryLines.docId, docId));
  const lines = rows.map((r): CountReportLine => {
    const expected = r.expectedMilli ?? r.currentMilli ?? 0;
    const counted = r.countedMilli ?? 0;
    const diff = posted ? r.deltaMilli : counted - expected;
    const cost = posted ? (r.lineCost ?? 0) : r.avgCostMinor || r.costMinor || 0;
    return {
      productId: r.productId,
      name: r.name,
      variantLabel: r.variantLabel,
      unitName: r.unitName,
      expectedMilli: expected,
      countedMilli: counted,
      diffMilli: diff,
      unitCostMinor: cost,
      valueMinor: diffValue(diff, cost),
      kind: diff < 0 ? 'short' : diff > 0 ? 'surplus' : 'match',
    };
  });
  lines.sort((a, b) => Math.abs(b.valueMinor) - Math.abs(a.valueMinor) || Math.abs(b.diffMilli) - Math.abs(a.diffMilli) || a.name.localeCompare(b.name));
  return { count, lines };
}

/** «اتعدّ 34 من 120»: counted lines vs stock-tracked live products in the count's scope; `missing` = uncounted with stock. */
export async function countProgress(db: Db, docId: string): Promise<{ counted: number; total: number; missing: number }> {
  const doc = (await db.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
  if (!doc) return { counted: 0, total: 0, missing: 0 };
  const cat = scopeCategoryId(doc.reason);
  const conds = [isNull(products.deletedAt), eq(products.trackStock, true), eq(products.isActive, true)];
  if (cat) conds.push(eq(products.categoryId, cat));
  const total = n((await db.select({ c: sql<number>`count(*)` }).from(products).where(and(...conds)))[0]?.c);
  const counted = n((await db.select({ c: sql<number>`count(*)` }).from(inventoryLines).where(eq(inventoryLines.docId, docId)))[0]?.c);
  const missing = doc.status === 'DRAFT' ? (await uncountedInScope(db, docId, cat, doc.warehouseId)).length : 0;
  return { counted, total: Math.max(total, counted), missing };
}
