/**
 * Excel/CSV product import (validated rows from packages/shared/productImport) and export rows.
 * Commits in chunks (each chunk = one transaction) so the UI stays responsive and shows progress.
 * Existing products are matched by barcode, then SKU.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { IMPORT_TEMPLATE_AR, UNLIMITED, type ImportRow } from '@daftarak/shared';
import { barcodes, categories, productUnits, products, stockLevels, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite, getLicenceState, LicenceError } from '../licence/guard';
import { nowOf, type InvCtx } from './context';
import { categoryIdByName, defaultUnitId, unitIdByName } from './catalog';
import { insertProductRows, liveProductCount, postOpeningStock } from './products';
import { refreshProductSearch } from './search';

export interface ImportOptions {
  /** Existing product (same barcode/SKU): update name, prices, cost, category, low-stock. Otherwise skip it. */
  updateExisting: boolean;
  chunkSize?: number;
}

export interface ImportReport {
  created: number;
  updated: number;
  skippedExisting: number;
  failed: { rowNumber: number; code: 'barcode_taken' | 'limit' | 'feature_unavailable' }[];
  openingDocIds: string[];
  ms: number;
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

export async function importProducts(ctx: InvCtx, rows: ImportRow[], opts: ImportOptions, onProgress?: (done: number, total: number) => void): Promise<ImportReport> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  const t0 = Date.now();
  const report: ImportReport = { created: 0, updated: 0, skippedExisting: 0, failed: [], openingDocIds: [], ms: 0 };
  const limit = getLicenceState()?.limits.products ?? UNLIMITED;
  let live = await liveProductCount(ctx.db);
  const multiUnit = ctx.features.includes('multi_unit');
  const catCache = new Map<string, string>();
  const unitCache = new Map<string, string>();
  const fallbackUnit = await defaultUnitId(ctx.db);
  const chunk = opts.chunkSize ?? 250;

  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    await withTx(ctx.db, async (tx) => {
      const now = nowOf(ctx);
      // Existing matches for this chunk in two queries (not one per row).
      const codes = part.flatMap((r) => [r.barcode, r.largerBarcode]).filter((c): c is string => !!c);
      const codeHits = codes.length
        ? await tx.select({ code: barcodes.code, productId: barcodes.productId }).from(barcodes).where(and(inArray(barcodes.code, codes), isNull(barcodes.deletedAt)))
        : [];
      const byCode = new Map(codeHits.map((h) => [h.code, h.productId]));
      const skus = part.map((r) => r.sku).filter((s): s is string => !!s);
      const skuHits = skus.length ? await tx.select({ sku: products.sku, id: products.id }).from(products).where(and(inArray(products.sku, skus), isNull(products.deletedAt))) : [];
      const bySku = new Map(skuHits.map((h) => [h.sku!, h.id]));
      const opening: { productId: string; qtyMilli: number; unitCostMinor: number }[] = [];

      for (const r of part) {
        const existingId = (r.barcode && byCode.get(r.barcode)) || (r.sku && bySku.get(r.sku)) || null;
        if (existingId) {
          if (!opts.updateExisting) {
            report.skippedExisting++;
            continue;
          }
          const set: Partial<typeof products.$inferInsert> = { name: r.name, updatedAt: now };
          if (r.costMinor != null) set.costMinor = r.costMinor;
          if (r.retailMinor != null) set.retailPriceMinor = r.retailMinor;
          if (r.wholesaleMinor != null) set.wholesalePriceMinor = r.wholesaleMinor;
          if (r.lowStockMilli != null) set.lowStockMilli = r.lowStockMilli;
          if (r.category) set.categoryId = await categoryIdByName(tx, ctx, r.category, catCache);
          await tx.update(products).set(set).where(eq(products.id, existingId));
          await refreshProductSearch(tx, existingId);
          report.updated++;
          continue;
        }
        if (r.largerUnit && !multiUnit) {
          report.failed.push({ rowNumber: r.rowNumber, code: 'feature_unavailable' });
          continue;
        }
        if (limit !== UNLIMITED && live >= limit) {
          report.failed.push({ rowNumber: r.rowNumber, code: 'limit' });
          continue;
        }
        // A barcode used twice inside this chunk by new rows is caught by validation; here guard against DB clashes.
        if ((r.largerBarcode && byCode.has(r.largerBarcode)) || (r.barcode && byCode.has(r.barcode))) {
          report.failed.push({ rowNumber: r.rowNumber, code: 'barcode_taken' });
          continue;
        }
        const baseUnitId = r.unit ? await unitIdByName(tx, ctx, r.unit, unitCache) : fallbackUnit;
        const cost = r.costMinor ?? 0;
        const { productId } = await insertProductRows(
          tx,
          ctx,
          {
            name: r.name,
            sku: r.sku,
            categoryId: r.category ? await categoryIdByName(tx, ctx, r.category, catCache) : null,
            baseUnitId,
            costMinor: cost,
            retailPriceMinor: r.retailMinor ?? 0,
            wholesalePriceMinor: r.wholesaleMinor ?? r.retailMinor ?? 0,
            trackStock: true,
            trackExpiry: false,
            lowStockMilli: r.lowStockMilli,
            barcodes: r.barcode ? [r.barcode] : [],
            largerUnit:
              r.largerUnit && r.largerFactorMilli
                ? { unitId: await unitIdByName(tx, ctx, r.largerUnit, unitCache), factorMilli: r.largerFactorMilli, retailPriceMinor: r.largerPriceMinor, wholesalePriceMinor: null, barcode: r.largerBarcode }
                : null,
          },
          now,
        );
        if (r.barcode) byCode.set(r.barcode, productId);
        if (r.largerBarcode) byCode.set(r.largerBarcode, productId);
        if (r.qtyMilli) opening.push({ productId, qtyMilli: r.qtyMilli, unitCostMinor: cost });
        live++;
        report.created++;
      }
      const docId = await postOpeningStock(tx, ctx, opening, now, 'import');
      if (docId) report.openingDocIds.push(docId);
    });
    onProgress?.(Math.min(i + chunk, rows.length), rows.length);
    await yieldToUi();
  }
  report.ms = Date.now() - t0;
  await withTx(ctx.db, async (tx) => {
    await appendAudit(tx, {
      action: 'product.import',
      entity: 'products',
      after: { created: report.created, updated: report.updated, skipped: report.skippedExisting, failed: report.failed.length },
      userId: ctx.user.id,
      deviceId: ctx.device.id,
      at: nowOf(ctx),
    });
  });
  if (report.failed.some((f) => f.code === 'limit') && report.created === 0) throw new LicenceError('limit', 'products');
  return report;
}

/** Rows for "Export to Excel" in the same column order as the import template (round-trips). */
export async function exportProductRows(db: Db, includeCost: boolean): Promise<(string | number)[][]> {
  const ps = await db
    .select({
      id: products.id,
      name: products.name,
      variantLabel: products.variantLabel,
      sku: products.sku,
      category: categories.name,
      unit: units.nameAr,
      cost: products.costMinor,
      retail: products.retailPriceMinor,
      wholesale: products.wholesalePriceMinor,
      qty: stockLevels.qtyMilli,
      low: products.lowStockMilli,
    })
    .from(products)
    .innerJoin(units, eq(units.id, products.baseUnitId))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
    .where(isNull(products.deletedAt))
    .orderBy(products.name);
  const allCodes = await db.select({ productId: barcodes.productId, code: barcodes.code, unitRow: barcodes.productUnitId }).from(barcodes).where(isNull(barcodes.deletedAt));
  const larger = await db.select({ id: productUnits.id, productId: productUnits.productId, factor: productUnits.factorMilli, price: productUnits.retailPriceMinor, unit: units.nameAr }).from(productUnits).innerJoin(units, eq(units.id, productUnits.unitId)).where(and(eq(productUnits.isBase, false), isNull(productUnits.deletedAt)));
  const largerBy = new Map(larger.map((l) => [l.productId, l]));
  const money = (m: number | null) => (m == null ? '' : m / 100);
  const qty = (q: number | null) => (q == null ? '' : q / 1000);
  return [
    IMPORT_TEMPLATE_AR.headers,
    ...ps.map((p) => {
      const lu = largerBy.get(p.id);
      const baseCode = allCodes.find((c) => c.productId === p.id && c.unitRow !== lu?.id)?.code ?? '';
      const luCode = lu ? (allCodes.find((c) => c.unitRow === lu.id)?.code ?? '') : '';
      return [
        p.variantLabel ? `${p.name} - ${p.variantLabel}` : p.name,
        baseCode,
        p.sku ?? '',
        p.category ?? '',
        p.unit,
        includeCost ? money(p.cost) : '',
        money(p.retail),
        money(p.wholesale),
        qty(p.qty ?? 0),
        qty(p.low),
        lu?.unit ?? '',
        lu ? lu.factor / 1000 : '',
        lu ? money(lu.price) : '',
        luCode,
      ];
    }),
  ];
}

