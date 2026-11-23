/**
 * Backup orchestration: "backup now", the automatic daily backup that rides on the check-in, local export,
 * and restore on a new phone. Business data never leaves the phone unencrypted.
 */
import * as Network from 'expo-network';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import type { ObkHeader } from '@daftarak/shared';
import { getDb, closeDatabase, openDatabase } from '../../db/client';
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
import { buildBackup, decryptBackup, downloadBackup, installSnapshot, openSnapshot, uploadBackup, type BuiltBackup } from './files';

export interface LastBackup {
  at: number;
  size: number;
  id: string | null;
  kind: 'auto' | 'manual' | 'local';
}

export const SCHEMA_VERSION = Object.keys(migrations.migrations).length;
const AUTO_EVERY_MS = 20 * 3_600_000;

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
    if (opts.cloudHead !== false) await setMeta(tx, 'backup.lastHead', (await chainHead(tx, dev.id)).hash);
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

// ── automatic daily backup (rides on the check-in: PLAN.md §9.3) ──

let prepared: BuiltBackup | null = null;

/** Before the check-in: build today's file if due (data changed, ≥ 20 h, Wi-Fi or small file). */
export async function prepareAutoBackup(): Promise<{ size: number; sha256: string; counts: Record<string, number>; schemaVersion: number } | undefined> {
  try {
    const db = getDb();
    const dev = await getCurrentDevice(db);
    if (!dev) return undefined;
    const last = await lastBackup();
    if (last && Date.now() - last.at < AUTO_EVERY_MS) return undefined;
    if ((await getMeta(db, 'backup.lastHead')) === (await chainHead(db, dev.id)).hash && last) return undefined;
    const net = await Network.getNetworkStateAsync();
    if (!net.isConnected) return undefined;
    const { header: h } = await header();
    prepared = await buildBackup(await getOrCreateBackupKey(), h);
    const waitedLong = last ? Date.now() - last.at > 72 * 3_600_000 : true;
    if (net.type !== Network.NetworkStateType.WIFI && !(waitedLong && prepared.size < 20 * 1024 * 1024)) {
      prepared.file.delete();
      prepared = null;
      return undefined;
    }
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
  const { backupKey } = await api.backupKey(token, restoreBusinessId());
  const out = await decryptBackup(file, backupKey, (p) => onProgress?.(p, 'decrypt'));
  file.delete();
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

/** Replace this phone's data with the staged backup, register the phone (old one deactivated), reopen. */
export async function applyRestore(token: string, serverBusinessId: string, device: Parameters<typeof api.activateDevice>[2]) {
  if (!staged) throw new Error('nothing staged');
  const reg = await api.activateDevice(token, serverBusinessId, device, staged.backupId, await integrityToken('activate'));
  closeDatabase();
  installSnapshot(staged.snapshot, await getOrCreateDbKey(), staged.images);
  const db = await openDatabase();
  await completeRestore(db, { deviceId: reg.registration.deviceId, deviceCode: reg.registration.deviceCode }, { platform: Platform.OS === 'ios' ? 'ios' : 'android', backupId: staged.backupId });
  staged = null;
  return reg;
}
