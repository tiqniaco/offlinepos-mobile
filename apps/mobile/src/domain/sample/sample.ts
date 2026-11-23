/**
 * Sample data to try the app in a minute (PLAN.md Phase 7): a few categories, ~20 everyday products with
 * prices and barcodes, 3 customers, 2 suppliers. No stock and no documents are created, so removing it later
 * leaves nothing behind (soft delete of exactly the rows it added).
 */
import { saveCategory, listUnits } from '../inventory/catalog';
import { createProduct, deleteProduct } from '../inventory/products';
import { deleteParty, saveParty } from '../parties/parties';
import { getMeta, setMeta } from '../device';
import type { InvCtx } from '../inventory/context';

const CATS: { name: string; color: string; items: [string, number, string][] }[] = [
  { name: 'مشروبات', color: '#0E8C80', items: [['شاي 250 جم', 3500, '6220001000011'], ['قهوة 200 جم', 9500, '6220001000028'], ['مياه 1.5 لتر', 900, '6220001000035'], ['عصير مانجو 1 لتر', 3200, '6220001000042'], ['مشروب غازي 1 لتر', 2500, '6220001000059']] },
  { name: 'بقالة', color: '#B17016', items: [['أرز 1 كيلو', 3800, '6220002000010'], ['سكر 1 كيلو', 3300, '6220002000027'], ['زيت 800 مل', 7500, '6220002000034'], ['مكرونة 400 جم', 1500, '6220002000041'], ['عدس 500 جم', 3000, '6220002000058'], ['دقيق 1 كيلو', 2600, '6220002000065']] },
  { name: 'ألبان', color: '#306FAA', items: [['لبن 1 لتر', 3600, '6220003000019'], ['جبنة بيضاء 500 جم', 6000, '6220003000026'], ['زبادي', 1000, '6220003000033'], ['زبدة 200 جم', 7000, '6220003000040']] },
  { name: 'منظفات', color: '#A8352E', items: [['مسحوق غسيل 1 كيلو', 8500, '6220004000018'], ['صابون سائل', 4500, '6220004000025'], ['مناديل', 1500, '6220004000032'], ['منظف أطباق', 3000, '6220004000049']] },
];

export async function hasSampleData(ctx: Pick<InvCtx, 'db'>): Promise<boolean> {
  return !!(await getMeta(ctx.db, 'sample.ids'));
}

/** Prices are in the business currency (minor units); SAR prices are scaled to typical Saudi prices. */
export async function addSampleData(ctx: InvCtx, currency: 'EGP' | 'SAR') {
  const piece = (await listUnits(ctx.db)).find((u) => u.nameAr === 'قطعة')!.id;
  const k = currency === 'SAR' ? 0.12 : 1;
  const ids: { products: string[]; customers: string[]; suppliers: string[]; categories: string[] } = { products: [], customers: [], suppliers: [], categories: [] };
  for (const c of CATS) {
    const catId = await saveCategory(ctx, { name: c.name, color: c.color });
    ids.categories.push(catId);
    for (const [name, price, code] of c.items) {
      const retail = Math.max(100, Math.round((price * k) / 25) * 25);
      ids.products.push(
        await createProduct(ctx, { name, categoryId: catId, baseUnitId: piece, costMinor: Math.round(retail * 0.8), retailPriceMinor: retail, wholesalePriceMinor: Math.round(retail * 0.92), trackStock: true, trackExpiry: false, barcodes: [code], lowStockMilli: 5000 }),
      );
    }
  }
  for (const [name, mobile] of [['محمد أحمد', '01011111111'], ['سارة محمود', '01022222222'], ['مطعم البيت', null]] as const) ids.customers.push(await saveParty(ctx, 'C', { name, mobile }));
  for (const name of ['شركة التوريدات', 'مخزن الجملة']) ids.suppliers.push(await saveParty(ctx, 'S', { name }));
  await setMeta(ctx.db, 'sample.ids', JSON.stringify(ids));
  return ids.products.length;
}

/** Remove what addSampleData added (anything already used in a document is kept, the rest is soft-deleted). */
export async function removeSampleData(ctx: InvCtx) {
  const raw = await getMeta(ctx.db, 'sample.ids');
  if (!raw) return;
  const ids = JSON.parse(raw) as { products: string[]; customers: string[]; suppliers: string[] };
  for (const id of ids.products) await deleteProduct(ctx, id).catch(() => undefined);
  for (const id of ids.customers) await deleteParty(ctx, 'C', id).catch(() => undefined);
  for (const id of ids.suppliers) await deleteParty(ctx, 'S', id).catch(() => undefined);
  await setMeta(ctx.db, 'sample.ids', '');
}
