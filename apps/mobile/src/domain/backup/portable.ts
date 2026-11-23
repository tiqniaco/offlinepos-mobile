/**
 * Portable ".kashiro" backups (the shop's own copy on Google Drive / Files) — the database steps, driver-independent
 * and tested in Node. File work and the share sheet live in features/backup/portable.ts; the container and crypto in
 * @daftarak/shared (portableBackup.ts).
 *
 * Restore WITHOUT our server:
 * - fresh phone: the data is installed, a provisional local device becomes current (its own numbering and chain),
 *   the old phone's licence is dropped (it is bound to the old phone) → the app opens READ-ONLY (view, print, export,
 *   PIN unlock) until the owner connects once and links this phone to the account (linkRestoredDevice).
 * - existing, still-empty shop of the SAME business on this phone: this phone keeps its own registration, licence and
 *   sign-in, so it stays fully usable.
 */
import { count, eq } from 'drizzle-orm';
import { uuidv7 } from '@daftarak/shared';
import { business, integrityChain, licenceState, purchaseDocs, salesDocs } from '../../db/schema';
import type { Db } from '../../db/types';
import { getMeta, setMeta } from '../device';
import { backupCounts, businessName, completeRestore } from './restore';

export const UNLINKED_META = 'restore.unlinked';
export const LAST_PORTABLE_META = 'backup.lastPortable';
/** Weekly reminder for the shop's own copy (Drive / file). */
export const PORTABLE_REMIND_DAYS = 7;

/** Unencrypted header fields: business name, date, counts — never customer data. */
export async function portableMeta(db: Db): Promise<{ businessName: string; counts: Record<string, number> }> {
  const c = await backupCounts(db);
  const counts: Record<string, number> = {};
  for (const k of ['invoices', 'products', 'customers', 'suppliers'] as const) counts[k] = Number(c[k] ?? 0);
  return { businessName: (await businessName(db)) ?? '', counts };
}

/** Any document at all (posted or draft) → restoring over this shop would lose work, so it is refused. */
export async function hasDocuments(db: Db): Promise<boolean> {
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  return (
    (await n(db.select({ n: count() }).from(integrityChain))) > 0 ||
    (await n(db.select({ n: count() }).from(salesDocs))) > 0 ||
    (await n(db.select({ n: count() }).from(purchaseDocs))) > 0
  );
}

export async function serverBusinessIdOf(db: Db): Promise<string | null> {
  return (await db.select({ id: business.serverBusinessId }).from(business).limit(1))[0]?.id ?? null;
}

/** Local device for a phone restored offline. "L" + 4 chars: never a server code (those are letters A, B, …). */
export function provisionalDevice(now = Date.now(), random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const code = 'L' + [...random(4)].map((b) => abc[b % abc.length]).join('');
  return { deviceId: uuidv7(now), deviceCode: code };
}

type LicenceRow = typeof licenceState.$inferSelect;

/** Read before the file is replaced (existing shop): this phone's own licence row. */
export async function currentLicenceRow(db: Db): Promise<LicenceRow | null> {
  return (await db.select().from(licenceState).where(eq(licenceState.id, 1)).limit(1))[0] ?? null;
}

async function putLicence(db: Db, row: Omit<LicenceRow, 'id'>) {
  const has = (await db.select({ id: licenceState.id }).from(licenceState).where(eq(licenceState.id, 1)))[0];
  if (has) await db.update(licenceState).set(row).where(eq(licenceState.id, 1));
  else await db.insert(licenceState).values({ id: 1, ...row });
}

export type PortableRestoreMode =
  /** New phone, no server: provisional device, no licence (read-only until linked). */
  | { kind: 'offline' }
  /** This phone is already registered for the same business: keep its device and licence. */
  | { kind: 'keep'; device: { id: string; code: string }; licence: LicenceRow | null };

/** Run on the restored database once it is the live DB. */
export async function finishPortableRestore(db: Db, mode: PortableRestoreMode, opts: { platform: 'ios' | 'android'; now?: number; random?: (n: number) => Uint8Array }) {
  const now = opts.now ?? Date.now();
  if (mode.kind === 'keep') {
    await completeRestore(db, { deviceId: mode.device.id, deviceCode: mode.device.code }, { platform: opts.platform, backupId: null, now });
    if (mode.licence) {
      const { id: _id, ...rest } = mode.licence;
      await putLicence(db, { ...rest, updatedAt: now });
    } else await putLicence(db, { token: null, lastCheckinAt: null, lastServerTime: null, maxSeenTime: 0, updatedAt: now });
    await setMeta(db, UNLINKED_META, '');
    return { deviceId: mode.device.id, deviceCode: mode.device.code };
  }
  const dev = provisionalDevice(now, opts.random);
  await completeRestore(db, dev, { platform: opts.platform, backupId: null, now });
  // The old phone's licence is bound to the old phone; keep the trusted clock (rollback guard), drop the token.
  const old = await currentLicenceRow(db);
  await putLicence(db, { token: null, lastCheckinAt: null, lastServerTime: old?.lastServerTime ?? null, maxSeenTime: old?.maxSeenTime ?? 0, updatedAt: now });
  await setMeta(db, UNLINKED_META, '1');
  return dev;
}

export async function isUnlinked(db: Db): Promise<boolean> {
  return (await getMeta(db, UNLINKED_META)) === '1';
}

/** Online, later: the server registered this phone (attach) → it becomes the current device; the licence is stored by the caller. */
export async function linkRestoredDevice(db: Db, reg: { deviceId: string; deviceCode: string }, opts: { platform: 'ios' | 'android'; now?: number }) {
  await completeRestore(db, reg, { platform: opts.platform, backupId: null, now: opts.now });
  await setMeta(db, UNLINKED_META, '');
}

export async function recordPortableExport(db: Db, at: number) {
  await setMeta(db, LAST_PORTABLE_META, String(at));
}

export async function lastPortableExport(db: Db): Promise<number | null> {
  const v = Number((await getMeta(db, LAST_PORTABLE_META)) ?? 0);
  return v > 0 ? v : null;
}

/** "Last copy on Drive X days ago" — due after a week (or never made). */
export function portableReminder(lastAt: number | null, now = Date.now()): { days: number | null; due: boolean } {
  if (!lastAt) return { days: null, due: true };
  const days = Math.max(0, Math.floor((now - lastAt) / 86_400_000));
  return { days, due: days >= PORTABLE_REMIND_DAYS };
}
