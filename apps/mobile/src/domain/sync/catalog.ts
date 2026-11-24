/**
 * The shop's catalog as the cashier phones need it: products, prices, barcodes, units, categories, customers,
 * offers, users (with their PIN/password hashes) and roles, the shop settings and the stock on hand.
 * Built on the main phone, sealed with the sync key, installed on cashier phones (upsert: never deletes their own
 * sales; rows deleted on the main phone arrive soft-deleted).
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import {
  barcodes,
  business,
  categories,
  customers,
  offers,
  partyBalances,
  productGroups,
  products,
  productUnits,
  roles,
  settings,
  stockLevels,
  syncOutbox,
  units,
  users,
  warehouses,
} from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';

export const CATALOG_VERSION = 1;

/** Settings that belong to the phone / person, never copied. */
const PERSONAL = new Set(['language', 'autoLockMinutes', 'palette', 'appearance', 'font', 'textSize', 'sounds', 'soundVolume', 'haptics', 'notifications', 'tipsSeen', 'printer', 'hideSensitive', 'appSwitcherCover', 'blockScreenshots']);

type Row = Record<string, unknown>;
const TABLES = [
  ['roles', roles],
  ['users', users],
  ['categories', categories],
  ['units', units],
  ['productGroups', productGroups],
  ['products', products],
  ['productUnits', productUnits],
  ['barcodes', barcodes],
  ['customers', customers],
  ['offers', offers],
  ['warehouses', warehouses],
] as const;

export interface Catalog {
  v: number;
  at: number;
  business: Row;
  settings: { key: string; valueJson: string; updatedAt: number }[];
  tables: Record<(typeof TABLES)[number][0], Row[]>;
  stock: Row[];
  balances: Row[];
}

export async function buildCatalog(db: Db, now = Date.now()): Promise<Catalog> {
  const tables = {} as Catalog['tables'];
  for (const [name, t] of TABLES) tables[name] = (await db.select().from(t as SQLiteTable)) as Row[];
  const b = (await db.select().from(business).limit(1))[0]!;
  const { id: _id, ...bRest } = b;
  return {
    v: CATALOG_VERSION,
    at: now,
    business: bRest,
    settings: (await db.select().from(settings)).filter((s) => !PERSONAL.has(s.key)),
    tables,
    stock: (await db.select().from(stockLevels)) as Row[],
    balances: (await db.select().from(partyBalances).where(eq(partyBalances.partyType, 'C'))) as Row[],
  };
}

/** Fingerprint without the build time (unchanged catalog → nothing to upload). */
export function catalogKey(c: Catalog): string {
  const { at: _at, ...rest } = c;
  let h = 5381;
  const s = JSON.stringify(rest);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${h >>> 0}`;
}

/** Quantities sold on this phone that the main phone has not applied yet (still to come out of its stock). */
export async function pendingStock(db: Db): Promise<Map<string, number>> {
  const rows = await db.select({ s: syncOutbox.stockJson }).from(syncOutbox).where(sql`${syncOutbox.appliedAt} IS NULL`);
  const m = new Map<string, number>();
  for (const r of rows) for (const [p, q] of JSON.parse(r.s ?? '[]') as [string, number][]) m.set(p, (m.get(p) ?? 0) + q);
  return m;
}

async function upsert(tx: Db, t: SQLiteTable, rows: Row[], target: unknown) {
  for (const r of rows) await tx.insert(t).values(r as never).onConflictDoUpdate({ target: target as never, set: r as never });
}

export async function installCatalog(db: Db, c: Catalog): Promise<void> {
  if (c.v !== CATALOG_VERSION) throw new Error('catalog_version');
  const pending = await pendingStock(db);
  await withTx(db, async (tx) => {
    for (const [name, t] of TABLES) await upsert(tx, t as SQLiteTable, c.tables[name] ?? [], (t as unknown as { id: unknown }).id);
    // Barcodes and product units can be removed for real on the main phone.
    const bc = (c.tables.barcodes ?? []).map((r) => String(r.id));
    if (bc.length) await tx.delete(barcodes).where(notInArray(barcodes.id, bc));
    else await tx.delete(barcodes);
    for (const s of c.settings) await tx.insert(settings).values(s).onConflictDoUpdate({ target: settings.key, set: { valueJson: s.valueJson, updatedAt: s.updatedAt } });
    // Stock = the main phone's figure minus what this phone sold that the main phone has not received yet.
    for (const r of c.stock) {
      const q = Number(r.qtyMilli) - (pending.get(String(r.productId)) ?? 0);
      const avg = Number(r.avgCostMinor);
      const row = { ...r, qtyMilli: q, valueMinor: Math.round((q * avg) / 1000) };
      await tx.insert(stockLevels).values(row as never).onConflictDoUpdate({ target: [stockLevels.productId, stockLevels.warehouseId], set: row as never });
    }
    // Products with no stock row on the main phone: whatever this phone sold since (negative).
    for (const [p, q] of pending) {
      if (c.stock.some((r) => r.productId === p)) continue;
      const wh = (c.tables.warehouses ?? []).find((w) => w.isDefault)?.id as string | undefined;
      if (!wh) continue;
      const row = { productId: p, warehouseId: wh, qtyMilli: -q, avgCostMinor: 0, valueMinor: 0, lastMovementAt: c.at };
      await tx.insert(stockLevels).values(row).onConflictDoUpdate({ target: [stockLevels.productId, stockLevels.warehouseId], set: row });
    }
    for (const r of c.balances) await tx.insert(partyBalances).values(r as never).onConflictDoUpdate({ target: [partyBalances.partyType, partyBalances.partyId], set: r as never });
    // Only one default warehouse: the main phone's.
    const mainWh = (c.tables.warehouses ?? []).map((w) => String(w.id));
    if (mainWh.length) await tx.update(warehouses).set({ isDefault: false }).where(and(notInArray(warehouses.id, mainWh), eq(warehouses.isDefault, true)));
    const b = c.business;
    await tx.update(business).set({
      name: String(b.name),
      vatRegistered: !!b.vatRegistered,
      vatNumber: (b.vatNumber as string | null) ?? null,
      crNumber: (b.crNumber as string | null) ?? null,
      address: (b.address as string | null) ?? null,
      phonesJson: String(b.phonesJson ?? '[]'),
    });
  });
}
