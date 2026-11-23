/**
 * Backup orchestration: "backup now", the automatic daily backup that rides on the check-in, local export,
 * and restore on a new phone. Business data never leaves the phone unencrypted.
 */
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import type { ObkHeader } from '@daftarak/shared';
import { sql } from 'drizzle-orm';
import { getDb, closeDatabase, openDatabase, moveDatabaseAside, DB_NAME } from '../../db/client';
import { business } from '../../db/schema';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { getOrCreateBackupKey, getOrCreateDbKey, setSecret, SECURE_KEYS } from '../../lib/secure';
import { APP_VERSION } from '../../config/env';
import { getCurrentDevice, getMeta, setMeta } from '../../domain/device';
import { backupCounts, completeRestore } from '../../domain/backup/restore';
import { chainHead } from '../../domain/integrity/chain';
import { appendAudit } from '../../domain/audit/audit';
import { withTx } from '../../db/tx';
import migrations from '../../db/migrations/migrations';
import { restoreBusinessId } from './restoreState';
import { integrityToken } from '../integrity/integrity';
import { backupHeader, buildBackup, decryptBackup, downloadBackup, installSnapshot, openSnapshot, uploadBackup, type BuiltBackup } from './files';
import { Directory, File, Paths } from 'expo-file-system';

export interface LastBackup {
  at: number;
  size: number;
  id: string | null;
  kind: 'auto' | 'manual' | 'local';
}

export const SCHEMA_VERSION = Object.keys(migrations.migrations).length;
const AUTO_EVERY_MS = 20 * 3_600_000;
/** The automatic backup carries product photos once a week (they rarely change and dominate the file size). */
const PHOTOS_EVERY_MS = 7 * 86_400_000;
/** Owners see a home reminder when no cloud backup succeeded for this long. */
export const BACKUP_STALE_MS = 3 * 86_400_000;

/** Thrown when a backup cannot be restored on this phone. */
export class RestoreError extends Error {
  constructor(public readonly code: 'app_outdated' | 'install_failed') {
    super(code);
    this.name = 'RestoreError';
  }
}

/** Last successful CLOUD backup (manual or automatic), or null. Local file exports do not count. */
export async function lastCloudBackupAt(): Promise<number | null> {
  const db = getDb();
  const v = await getMeta(db, 'backup.lastCloudAt');
  if (v) return Number(v) || null;
  const last = await lastBackup();
  return last && last.kind !== 'local' ? last.at : null;
}

export async function lastBackup(): Promise<LastBackup | null> {
  const v = await getMeta(getDb(), 'backup.last');
  return v ? (JSON.parse(v) as LastBackup) : null;
}

async function header(): Promise<{ header: ObkHeader; serverBusinessId: string }> {
  const db = getDb();
  const dev = (await getCurrentDevice(db))!;
  const b = (await db.select().from(business).limit(1))[0]!;
  const counts = await backupCounts(db);
  const numeric = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v ?? 0)]));
  return { header: { v: 1, businessId: b.serverBusinessId, deviceId: dev.id, deviceCode: dev.code, schemaVersion: SCHEMA_VERSION, createdAt: Date.now(), counts: numeric, appVersion: APP_VERSION }, serverBusinessId: b.serverBusinessId };
}

/** `cloudHead: false` for the shop's own file copy: it must not make the daily cloud backup think it is up to date. */
export async function recordDone(meta: LastBackup, opts: { cloudHead?: boolean } = {}) {
  const db = getDb();
  const dev = (await getCurrentDevice(db))!;
  await withTx(db, async (tx) => {
    await setMeta(tx, 'backup.last', JSON.stringify(meta));
    if (opts.cloudHead !== false) {
      await setMeta(tx, 'backup.lastHead', (await chainHead(tx, dev.id)).hash);
      if (meta.kind !== 'local') await setMeta(tx, 'backup.lastCloudAt', String(meta.at));
    }
    await appendAudit(tx, { action: 'backup.create', entity: 'backups', entityId: meta.id, after: { size: meta.size, kind: meta.kind }, deviceId: dev.id, at: meta.at });
  });
}

/** Manual "backup now": build → presigned PUT → upload → commit. */
export async function backupNow(onProgress?: (p: number, stage: 'build' | 'upload') => void): Promise<LastBackup> {
  const { header: h, serverBusinessId } = await header();
  const built = await buildBackup(await getOrCreateBackupKey(), h, (p) => onProgress?.(p, 'build'));
  try {
    const token = await accessToken();
    const put = await api.backupUploadUrl(token, { businessId: serverBusinessId, deviceId: h.deviceId, meta: { size: built.size, sha256: built.sha256, counts: h.counts, schemaVersion: SCHEMA_VERSION }, kind: 'manual' });
    onProgress?.(0, 'upload');
    await uploadBackup(built.file, put);
    await api.backupCommit(await accessToken(), put.backupId, serverBusinessId);
    const done: LastBackup = { at: Date.now(), size: built.size, id: put.backupId, kind: 'manual' };
    await recordDone(done);
    return done;
  } finally {
    if (built.file.exists) built.file.delete();
  }
}

// The shop's own copy (Drive / Files) is the passphrase-protected ".kashiro" file: features/backup/portable.ts.
// (An .obk exported with this phone's backup key could not be opened on a new phone without our server.)

/**
 * Days without a successful cloud backup when that reaches BACKUP_STALE_MS (home reminder for owners), else null.
 * A shop that never had one is measured from the first time this was asked (no nagging on day one).
 */
export async function cloudBackupOverdue(now = Date.now()): Promise<{ days: number; never: boolean } | null> {
  const db = getDb();
  let ref = await lastCloudBackupAt();
  const never = ref == null;
  if (ref == null) {
    const since = await getMeta(db, 'backup.watchSince');
    if (!since) {
      await setMeta(db, 'backup.watchSince', String(now));
      return null;
    }
    ref = Number(since) || now;
  }
  return now - ref >= BACKUP_STALE_MS ? { days: Math.floor((now - ref) / 86_400_000), never } : null;
}

// ── automatic daily backup (rides on the check-in: PLAN.md §9.3) ──

let prepared: (BuiltBackup & { photos: boolean }) | null = null;

/** Before the check-in: build today's file if due (data changed, ≥ 20 h, Wi-Fi or small file). */
export async function prepareAutoBackup(): Promise<{ size: number; sha256: string; counts: Record<string, number>; schemaVersion: number } | undefined> {
  try {
    const db = getDb();
    const dev = await getCurrentDevice(db);
    if (!dev) return undefined;
    const last = await lastBackup();
    if (last && Date.now() - last.at < AUTO_EVERY_MS) return undefined;
    if ((await getMeta(db, 'backup.lastHead')) === (await chainHead(db, dev.id)).hash && last) return undefined;
    // Network first: never spend battery building a file that cannot leave the phone today.
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected) return undefined;
    const wifi = net.type === Network.NetworkStateType.WIFI;
    const waitedLong = last ? Date.now() - last.at > 72 * 3_600_000 : true;
    if (!wifi && !waitedLong) return undefined;
    const photosAt = Number((await getMeta(db, 'backup.photosAt')) ?? 0);
    // Photos weekly, and only on Wi-Fi (mobile data uploads stay small).
    const photos = wifi && Date.now() - photosAt >= PHOTOS_EVERY_MS;
    const { header: h } = await header();
    const built = await buildBackup(await getOrCreateBackupKey(), h, undefined, { photos });
    if (!wifi && built.size >= 20 * 1024 * 1024) {
      built.file.delete();
      return undefined;
    }
    prepared = { ...built, photos };
    return { size: prepared.size, sha256: prepared.sha256, counts: h.counts, schemaVersion: SCHEMA_VERSION };
  } catch {
    prepared = null;
    return undefined;
  }
}

/** After the check-in: upload to the presigned URL; tomorrow's check-in commits it. */
export async function finishAutoBackup(put: { backupId: string; url: string; headers: Record<string, string> } | null | undefined) {
  const p = prepared;
  prepared = null;
  if (!p) return;
  try {
    if (put) {
      await uploadBackup(p.file, put);
      await setMeta(getDb(), 'backup.pending', JSON.stringify({ id: put.backupId, size: p.size }));
      if (p.photos) await setMeta(getDb(), 'backup.photosAt', String(Date.now()));
    }
  } catch {
    /* next day */
  } finally {
    if (p.file.exists) p.file.delete();
  }
}

export async function pendingBackupId(): Promise<string | undefined> {
  const v = await getMeta(getDb(), 'backup.pending');
  return v ? (JSON.parse(v) as { id: string }).id : undefined;
}

export async function markCommitted(committed: boolean | undefined) {
  const v = await getMeta(getDb(), 'backup.pending');
  if (!v || committed === undefined) return;
  const p = JSON.parse(v) as { id: string; size: number };
  await setMeta(getDb(), 'backup.pending', '');
  if (committed) await recordDone({ at: Date.now(), size: p.size, id: p.id, kind: 'auto' });
}

// ── restore on a new phone ──

export interface RestorePreview {
  businessName: string | null;
  counts: Record<string, number | null>;
  lastInvoice: string | null;
  createdAt: number;
  deviceCode: string;
}

let staged: { snapshot: File; images: import('expo-file-system').Directory; backupId: string } | null = null;

/** Download + decrypt (needs the key released after a step-up OTP) → preview numbers before anything is replaced. */
export async function stageRestore(token: string, backupId: string, onProgress?: (p: number, stage: 'download' | 'decrypt') => void): Promise<RestorePreview> {
  const d = await api.backupDownloadUrl(token, backupId);
  onProgress?.(0, 'download');
  const file = await downloadBackup(d.url);
  // A backup made by a NEWER app has tables this version does not know: refuse before decrypting anything.
  try {
    const h = await backupHeader(file);
    if ((h.schemaVersion ?? 0) > SCHEMA_VERSION) throw new RestoreError('app_outdated');
  } catch (e) {
    if (file.exists) file.delete();
    throw e;
  }
  const { backupKey } = await api.backupKey(token, restoreBusinessId());
  let out: Awaited<ReturnType<typeof decryptBackup>>;
  try {
    out = await decryptBackup(file, backupKey, (p) => onProgress?.(p, 'decrypt'));
  } finally {
    if (file.exists) file.delete();
  }
  if ((out.header.schemaVersion ?? 0) > SCHEMA_VERSION) {
    if (out.snapshot.exists) out.snapshot.delete();
    if (out.images.exists) out.images.delete();
    throw new RestoreError('app_outdated');
  }
  await setSecret(SECURE_KEYS.backupKey, backupKey);
  staged = { snapshot: out.snapshot, images: out.images, backupId };
  const conn = openSnapshot(out.snapshot);
  try {
    const name = conn.getFirstSync<{ name: string }>('SELECT name FROM business LIMIT 1')?.name ?? null;
    const last = conn.getFirstSync<{ number: string | null }>(`SELECT number FROM sales_docs WHERE type = 'INVOICE' AND status = 'POSTED' ORDER BY posted_at DESC LIMIT 1`)?.number ?? null;
    return { businessName: name, counts: out.header.counts, lastInvoice: last, createdAt: out.header.createdAt, deviceCode: out.header.deviceCode };
  } finally {
    conn.closeSync();
  }
}

const PENDING_ACTIVATION = 'restore.pendingActivation';

/** The installed copy must open and be sound before the old phone is deactivated. */
async function verifyInstalled() {
  const db = getDb();
  const ok = (await db.all<{ quick_check: string }>(sql`PRAGMA quick_check`))[0];
  if (!ok || Object.values(ok)[0] !== 'ok') throw new RestoreError('install_failed');
  if (!(await db.select({ id: business.id }).from(business).limit(1))[0]) throw new RestoreError('install_failed');
}

/** Drop a failed install (the data is still in the staged copy / the cloud) and start from an empty database again. */
async function discardInstalled() {
  closeDatabase();
  const dir = new Directory(Paths.document, 'SQLite');
  for (const suffix of ['', '-wal', '-shm']) {
    const f = new File(dir, DB_NAME + suffix);
    if (f.exists) f.delete();
  }
  await openDatabase();
}

/**
 * Replace this phone's data with the staged backup: install it and VERIFY it first, and only then register the
 * phone (which deactivates the old one) — a failed install must never cost the shop its working phone.
 */
export async function applyRestore(token: string, serverBusinessId: string, device: Parameters<typeof api.activateDevice>[2]) {
  if (!staged) throw new Error('nothing staged');
  const s = staged;
  closeDatabase();
  let reg: Awaited<ReturnType<typeof api.activateDevice>>;
  try {
    // Keep the decrypted copy until the very end so a retry does not need another download.
    installSnapshot(s.snapshot, await getOrCreateDbKey(), s.images, { keepSnapshot: true });
    const db = await openDatabase();
    await verifyInstalled();
    // Until activation completes this data must not be used as a shop (boot sets it aside: abandonIncompleteRestore).
    await setMeta(db, PENDING_ACTIVATION, s.backupId);
    reg = await api.activateDevice(token, serverBusinessId, device, s.backupId, await integrityToken('activate'));
  } catch (e) {
    await discardInstalled().catch(() => undefined);
    throw e;
  }
  const db = getDb();
  await completeRestore(db, { deviceId: reg.registration.deviceId, deviceCode: reg.registration.deviceCode }, { platform: Platform.OS === 'ios' ? 'ios' : 'android', backupId: s.backupId });
  await setMeta(db, PENDING_ACTIVATION, '');
  if (s.snapshot.exists) s.snapshot.delete();
  staged = null;
  return reg;
}

/**
 * Boot: a restore that was installed but never activated (app killed / phone off in between) is set aside so the
 * phone starts onboarding again instead of running as the OLD phone. Returns true when the DB was replaced.
 */
export async function abandonIncompleteRestore(): Promise<boolean> {
  const pending = await getMeta(getDb(), PENDING_ACTIVATION).catch(() => null);
  if (!pending) return false;
  moveDatabaseAside('restore-incomplete');
  return true;
}
