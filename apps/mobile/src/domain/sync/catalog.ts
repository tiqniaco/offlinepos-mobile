/**
 * The shop's catalog as the cashier phones need it: products, prices, barcodes, units, categories, customers,
 * offers, users (with their PIN/password hashes) and roles, the shop settings and the stock on hand.
 * Built on the main phone, sealed with the sync key, installed on cashier phones (upsert: never deletes their own
 * sales; rows deleted on the main phone arrive soft-deleted).
 */
import { and, eq, notInArray } from 'drizzle-orm';
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
  syncApplied,
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
  /**
   * Per cashier phone: which of its sales this catalog's stock already includes — every seq ≤ upTo except `failed`
   * (not posted yet). The cashier phone keeps subtracting the others.
   */
  applied: Record<string, { upTo: number; failed: number[] }>;
}

export async function buildCatalog(db: Db, now = Date.now()): Promise<Catalog> {
  const tables = {} as Catalog['tables'];
  for (const [name, t] of TABLES) tables[name] = (await db.select().from(t as SQLiteTable)) as Row[];
  // The owner's sign-in password is the account password: its hash never leaves the main phone (the owner works on
  // the main phone; cashier phones list the PIN users only).
  tables.users = tables.users.filter((u) => u.secretKind !== 'password');
  const b = (await db.select().from(business).limit(1))[0]!;
  const { id: _id, ...bRest } = b;
  const applied: Catalog['applied'] = {};
  for (const r of await db.select().from(syncApplied)) {
    const [dev, seqS] = r.key.split(':');
    const seq = Number(seqS);
    if (!dev || !Number.isFinite(seq)) continue;
    const a = (applied[dev] ??= { upTo: 0, failed: [] });
    if (r.error) a.failed.push(seq);
    else a.upTo = Math.max(a.upTo, seq);
  }
  return {
    v: CATALOG_VERSION,
    at: now,
    business: bRest,
    settings: (await db.select().from(settings)).filter((s) => !PERSONAL.has(s.key)),
    tables,
    stock: (await db.select().from(stockLevels)) as Row[],
    balances: (await db.select().from(partyBalances).where(eq(partyBalances.partyType, 'C'))) as Row[],
    applied,
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

/**
 * Quantities sold on this phone that the given catalog does not include yet (still to come out of its stock).
 * Without `applied` info: every sale the main phone has not acknowledged.
 */
export async function pendingStock(db: Db, applied?: { upTo: number; failed: number[] }): Promise<Map<string, number>> {
  const rows = await db.select({ seq: syncOutbox.seq, s: syncOutbox.stockJson, appliedAt: syncOutbox.appliedAt }).from(syncOutbox);
  const failed = new Set(applied?.failed ?? []);
  const m = new Map<string, number>();
  for (const r of rows) {
    const pending = applied ? r.seq > applied.upTo || failed.has(r.seq) : r.appliedAt == null;
    if (!pending) continue;
    for (const [p, q] of JSON.parse(r.s ?? '[]') as [string, number][]) m.set(p, (m.get(p) ?? 0) + q);
  }
  return m;
}

/** Columns kept as they are on this phone (PIN lockout is per phone). */
const LOCAL_COLUMNS: Record<string, string[]> = { users: ['failedPinAttempts', 'lockedUntil'] };

async function upsert(tx: Db, name: string, t: SQLiteTable, rows: Row[], target: unknown) {
  const keep = LOCAL_COLUMNS[name] ?? [];
  for (const r of rows) {
    const set = { ...r };
    for (const k of keep) delete set[k];
    const ins = keep.length ? { ...r, failedPinAttempts: 0, lockedUntil: null } : r;
    await tx.insert(t).values(ins as never).onConflictDoUpdate({ target: target as never, set: set as never });
  }
}

export async function installCatalog(db: Db, c: Catalog, deviceId: string): Promise<void> {
  await withTx(db, (tx) => installCatalogTx(tx, c, deviceId));
}

/** Inside the caller's transaction (the join writes the shop and its catalog atomically). */
export async function installCatalogTx(tx: Db, c: Catalog, deviceId: string): Promise<void> {
  if (c.v !== CATALOG_VERSION) throw new Error('catalog_version');
  const pending = await pendingStock(tx, c.applied?.[deviceId] ?? { upTo: 0, failed: [] });
  for (const [name, t] of TABLES) await upsert(tx, name, t as SQLiteTable, c.tables[name] ?? [], (t as unknown as { id: unknown }).id);
  // Barcodes can be removed for real on the main phone.
  const bc = (c.tables.barcodes ?? []).map((r) => String(r.id));
  if (bc.length) await tx.delete(barcodes).where(notInArray(barcodes.id, bc));
  else await tx.delete(barcodes);
  for (const s of c.settings) await tx.insert(settings).values(s).onConflictDoUpdate({ target: settings.key, set: { valueJson: s.valueJson, updatedAt: s.updatedAt } });
  // Stock = the main phone's figure minus what this phone sold that the catalog does not include yet.
  for (const r of c.stock) {
    const q = Number(r.qtyMilli) - (pending.get(String(r.productId)) ?? 0);
    const avg = Number(r.avgCostMinor);
    const row = { ...r, qtyMilli: q, valueMinor: Math.round((q * avg) / 1000) };
    await tx.insert(stockLevels).values(row as never).onConflictDoUpdate({ target: [stockLevels.productId, stockLevels.warehouseId], set: row as never });
  }
  const wh = (c.tables.warehouses ?? []).find((w) => w.isDefault)?.id as string | undefined;
  for (const [p, q] of pending) {
    if (!wh || c.stock.some((r) => r.productId === p)) continue;
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
}
