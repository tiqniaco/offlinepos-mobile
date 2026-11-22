/** Product full-text search (FTS5) with Arabic normalisation (PLAN.md D-16). */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { normalizeArabicForSearch } from '@daftarak/shared';
import { barcodes, products } from '../../db/schema';
import type { Db } from '../../db/types';

export async function refreshProductSearch(tx: Db, productId: string): Promise<void> {
  await tx.run(sql`DELETE FROM products_fts WHERE product_id = ${productId}`);
  const p = (await tx.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!p || p.deletedAt) return;
  const codes = await tx.select({ code: barcodes.code }).from(barcodes).where(and(eq(barcodes.productId, productId), isNull(barcodes.deletedAt)));
  const body = normalizeArabicForSearch([p.name, p.nameEn, p.sku, p.variantLabel, ...codes.map((c) => c.code)].filter(Boolean).join(' '));
  await tx.run(sql`INSERT INTO products_fts (product_id, body) VALUES (${productId}, ${body})`);
}

/** Converts user text into an FTS5 prefix query: every word must match the start of a token. */
export function ftsQuery(input: string): string | null {
  const tokens = normalizeArabicForSearch(input)
    .split(' ')
    .map((t) => t.replace(/["*^():]/g, ''))
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(' ');
}

/** Fast path for brand-new products (no previous row to delete, fields already in hand). */
export async function insertProductSearch(tx: Db, productId: string, fields: (string | null | undefined)[], codes: string[]): Promise<void> {
  const body = normalizeArabicForSearch([...fields, ...codes].filter(Boolean).join(' '));
  await tx.run(sql`INSERT INTO products_fts (product_id, body) VALUES (${productId}, ${body})`);
}
