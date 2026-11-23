import { getDb } from '../../db/client';
import { getProduct, productMovements } from '../../domain/inventory/products';
import type { DetailData } from './ProductDetailView';

export async function loadDetail(id: string): Promise<DetailData | null> {
  const db = getDb();
  const d = await getProduct(db, id);
  if (!d || d.product.deletedAt) return null; // deleted products only come back through "undo"
  const larger = d.units.find((u) => !u.isBase);
  const mv = await productMovements(db, id, 30);
  return {
    name: d.product.name,
    variantLabel: d.product.variantLabel,
    categoryName: d.categoryName,
    imagePath: d.product.imagePath,
    retailPriceMinor: d.product.retailPriceMinor,
    wholesalePriceMinor: d.product.wholesalePriceMinor,
    costMinor: d.product.costMinor,
    trackStock: d.product.trackStock,
    lowStockMilli: d.product.lowStockMilli,
    baseUnitName: d.baseUnit.nameAr,
    larger: larger ? { name: larger.unit.nameAr, factorMilli: larger.factorMilli, retailPriceMinor: larger.retailPriceMinor } : null,
    barcodes: d.barcodes.map((b) => b.code),
    level: d.level,
    variants: d.variants,
    movements: mv.map((m) => ({ id: m.id, type: m.type, qtyMilli: m.qtyMilli, occurredAt: m.occurredAt, reason: m.reason })),
  };
}

