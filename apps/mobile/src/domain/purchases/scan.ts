/**
 * Scanned supplier invoice → purchase cart (DB side of the OCR review). Pure matching lives in ocrMatch.ts.
 * - every line is entered in the UNIT the invoice is in (carton vs piece), so qty × price lands on the right stock;
 * - a line whose unit cost was derived from the printed line total keeps that exact total (line discount absorbs the
 *   rounding of the per-unit cost);
 * - the printed invoice discount goes into the cart; VAT inclusive / exclusive / none is chosen to match the printed
 *   tax and total; the computed total is compared with the printed one (more than 1% apart → the user must fix it).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { lineAmount, type OcrScanResponse } from '@daftarak/shared';
import { products, productUnits, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { pricePurchaseDraft, purchaseLineFor, type PurchaseCtx, type PurchaseLine } from './purchases';
import { pickUnit, toMinor, totalsMismatch, type ReviewLine, type UnitOption } from './ocrMatch';

/** Units of a product (for the review's unit picker) with each unit's current cost. */
export async function scanUnitOptions(db: Db, productId: string): Promise<(UnitOption & { costMinor: number; name: string })[]> {
  const p = (await db.select({ cost: products.costMinor }).from(products).where(eq(products.id, productId)).limit(1))[0];
  const rows = await db.select().from(productUnits).innerJoin(units, eq(units.id, productUnits.unitId)).where(and(eq(productUnits.productId, productId), isNull(productUnits.deletedAt)));
  return rows
    .map(({ product_units: r, units: u }) => ({ id: r.id, factorMilli: r.factorMilli, isBase: r.isBase, name: u.nameAr, costMinor: Math.round(((p?.cost ?? 0) * r.factorMilli) / 1000) }))
    .sort((a, b) => a.factorMilli - b.factorMilli);
}

/** Default unit for a review line: the unit whose cost is closest to the printed unit price. */
export async function defaultScanUnit(db: Db, productId: string, scannedUnitPriceMinor: number | null): Promise<string | null> {
  const p = (await db.select({ cost: products.costMinor }).from(products).where(eq(products.id, productId)).limit(1))[0];
  return pickUnit(await scanUnitOptions(db, productId), p?.cost ?? 0, scannedUnitPriceMinor);
}

/** Purchase lines for the ready review lines, in their units, keeping exact line totals. */
export async function scanPurchaseLines(db: Db, ctx: Pick<PurchaseCtx, 'vatRegistered' | 'vatRateBp'>, lines: readonly ReviewLine[]): Promise<PurchaseLine[]> {
  const out: PurchaseLine[] = [];
  for (const l of lines) {
    if (l.skip || !l.product || !(l.qtyMilli > 0)) continue;
    const line = await purchaseLineFor(db, ctx, l.product.id, l.unitId, l.qtyMilli);
    let cost = l.costMinor ?? line.unitCostMinor;
    let discountMinor: number | undefined;
    if (l.costFromTotal && l.totalMinor != null) {
      // Per-unit cost rounded UP, the excess as a line discount: qty × cost − discount = the printed total exactly.
      cost = Math.ceil((l.totalMinor * 1000) / l.qtyMilli);
      const d = lineAmount(cost, l.qtyMilli) - l.totalMinor;
      if (d > 0) discountMinor = d;
    }
    out.push({ ...line, unitCostMinor: cost, ...(discountMinor ? { discountMinor } : {}) });
  }
  return out;
}

export interface ScanTotals {
  pricesIncludeVat: boolean;
  /** The invoice shows no tax: lines go in at 0% VAT. */
  zeroTax: boolean;
  invoiceDiscountMinor: number;
  computedTotalMinor: number;
  scannedTotalMinor: number | null;
  mismatch: boolean;
}

/**
 * Choose the VAT mode that reproduces the printed invoice and compare totals. `lines` are the scanned lines only.
 * The printed tax decides: none → 0% lines; otherwise inclusive or exclusive, whichever lands closer to the total.
 */
export function scanTotals(lines: PurchaseLine[], scan: Pick<OcrScanResponse, 'discount' | 'tax' | 'total'>, vatRegistered: boolean): ScanTotals & { lines: PurchaseLine[] } {
  const invoiceDiscountMinor = toMinor(scan.discount) ?? 0;
  const scannedTotalMinor = toMinor(scan.total);
  const tax = toMinor(scan.tax);
  const zeroTax = tax == null || tax === 0;
  const ls = zeroTax ? lines.map((l) => ({ ...l, taxRateBp: 0 })) : lines;
  const total = (inc: boolean) => (ls.length ? pricePurchaseDraft({ lines: ls, pricesIncludeVat: inc, invoiceDiscountMinor }, vatRegistered).totalMinor : 0);
  let pricesIncludeVat = true;
  let computed = total(true);
  if (!zeroTax) {
    const exc = total(false);
    if (scannedTotalMinor != null ? Math.abs(exc - scannedTotalMinor) < Math.abs(computed - scannedTotalMinor) : false) {
      pricesIncludeVat = false;
      computed = exc;
    }
  }
  return { lines: ls, pricesIncludeVat, zeroTax, invoiceDiscountMinor, computedTotalMinor: computed, scannedTotalMinor, mismatch: totalsMismatch(computed, scannedTotalMinor) };
}
