/** Categories and units (master data, soft delete). */
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { HybridLogicalClock, normalizeArabicForSearch, uuidv7 } from '@daftarak/shared';
import { categories, products, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite } from '../licence/guard';
import { InventoryError, nowOf, type InvCtx } from './context';

let hlc: HybridLogicalClock | null = null;
const tick = (ctx: InvCtx) => (hlc ??= new HybridLogicalClock(ctx.device.code)).tick();

export const CATEGORY_COLORS = ['#18A999', '#F2A93B', '#3B82C4', '#D9534A', '#3F9D4B', '#B17016', '#0B6B63', '#7C8A8F'];

export async function listCategories(db: Db) {
  return db
    .select({ id: categories.id, name: categories.name, color: categories.color, products: sql<number>`(SELECT count(*) FROM products p WHERE p.category_id = ${categories.id} AND p.deleted_at IS NULL)` })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .orderBy(asc(categories.sort), asc(categories.name));
}

export async function saveCategory(ctx: InvCtx, input: { id?: string; name: string; color?: string | null }): Promise<string> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  const name = input.name.trim();
  if (!name) throw new InventoryError('name_required');
  const now = nowOf(ctx);
  return withTx(ctx.db, async (tx) => {
    if (input.id) {
      await tx.update(categories).set({ name, color: input.color ?? null, updatedAt: now, hlc: tick(ctx) }).where(eq(categories.id, input.id));
      await appendAudit(tx, { action: 'category.change', entity: 'categories', entityId: input.id, after: { name }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
      return input.id;
    }
    const n = (await tx.select({ n: count() }).from(categories).where(isNull(categories.deletedAt)))[0]?.n ?? 0;
    const id = uuidv7(now);
    await tx.insert(categories).values({ id, name, color: input.color ?? CATEGORY_COLORS[n % CATEGORY_COLORS.length]!, sort: n, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: tick(ctx) });
    await appendAudit(tx, { action: 'category.change', entity: 'categories', entityId: id, after: { name, created: true }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
    return id;
  });
}

/** Soft delete; products in it become "without category". */
export async function deleteCategory(ctx: InvCtx, id: string): Promise<void> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  const now = nowOf(ctx);
  await withTx(ctx.db, async (tx) => {
    await tx.update(categories).set({ deletedAt: now, updatedAt: now, hlc: tick(ctx) }).where(eq(categories.id, id));
    await tx.update(products).set({ categoryId: null, updatedAt: now }).where(eq(products.categoryId, id));
    await appendAudit(tx, { action: 'category.change', entity: 'categories', entityId: id, after: { deleted: true }, userId: ctx.user.id, deviceId: ctx.device.id, at: now });
  });
}

/** Find a category by (normalised) name or create it — used by import. Call inside a transaction. */
export async function categoryIdByName(tx: Db, ctx: InvCtx, name: string, cache: Map<string, string>): Promise<string> {
  const key = normalizeArabicForSearch(name);
  const hit = cache.get(key);
  if (hit) return hit;
  const all = await tx.select({ id: categories.id, name: categories.name }).from(categories).where(isNull(categories.deletedAt));
  for (const c of all) cache.set(normalizeArabicForSearch(c.name), c.id);
  const again = cache.get(key);
  if (again) return again;
  const now = nowOf(ctx);
  const id = uuidv7(now);
  await tx.insert(categories).values({ id, name: name.trim(), color: CATEGORY_COLORS[all.length % CATEGORY_COLORS.length]!, sort: all.length, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: tick(ctx) });
  cache.set(key, id);
  return id;
}

export async function listUnits(db: Db) {
  return db.select().from(units).where(isNull(units.deletedAt)).orderBy(asc(units.sort), asc(units.nameAr));
}

export async function createUnit(ctx: InvCtx, input: { nameAr: string; nameEn?: string; allowsFraction: boolean }): Promise<string> {
  requirePermission(ctx.user, 'products.manage');
  assertCanWrite();
  if (!input.nameAr.trim()) throw new InventoryError('name_required');
  const now = nowOf(ctx);
  const id = uuidv7(now);
  await withTx(ctx.db, async (tx) => {
    const n = (await tx.select({ n: count() }).from(units))[0]?.n ?? 0;
    await tx.insert(units).values({ id, nameAr: input.nameAr.trim(), nameEn: input.nameEn?.trim() || input.nameAr.trim(), allowsFraction: input.allowsFraction, sort: n, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: tick(ctx) });
  });
  return id;
}

/** Unit by Arabic or English name, or create it (import). Call inside a transaction. */
export async function unitIdByName(tx: Db, ctx: InvCtx, name: string, cache: Map<string, string>): Promise<string> {
  const key = normalizeArabicForSearch(name);
  if (cache.size === 0) {
    const all = await tx.select().from(units).where(isNull(units.deletedAt));
    for (const u of all) {
      cache.set(normalizeArabicForSearch(u.nameAr), u.id);
      cache.set(normalizeArabicForSearch(u.nameEn), u.id);
    }
  }
  const hit = cache.get(key);
  if (hit) return hit;
  const now = nowOf(ctx);
  const id = uuidv7(now);
  await tx.insert(units).values({ id, nameAr: name.trim(), nameEn: name.trim(), allowsFraction: false, sort: cache.size, createdAt: now, updatedAt: now, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: tick(ctx) });
  cache.set(key, id);
  return id;
}

export async function defaultUnitId(db: Db): Promise<string> {
  const u = (await db.select({ id: units.id }).from(units).where(and(isNull(units.deletedAt), eq(units.nameAr, 'قطعة'))).limit(1))[0] ?? (await db.select({ id: units.id }).from(units).where(isNull(units.deletedAt)).orderBy(asc(units.sort)).limit(1))[0];
  if (!u) throw new InventoryError('unit_required');
  return u.id;
}
