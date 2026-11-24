/**
 * «النسخ التلقائي في فولدر عندك»: a daily password-protected ".kashiro" file written into a folder the shop picked
 * once (Android Storage Access Framework: phone storage, SD card, or a Drive folder when the provider shows one).
 * Works fully offline and costs our server nothing. This module is the driver-independent part (settings in kv_meta,
 * file rotation, due / warning rules, the passphrase in the OS keystore) — tested in Node. File work:
 * features/backup/folderBackup.ts.
 */
import { portablePassphraseOk, PORTABLE_EXT } from '@daftarak/shared';
import type { Db } from '../../db/types';
import { getMeta, setMeta } from '../device';

export const FOLDER_META = {
  uri: 'backup.folder.uri',
  label: 'backup.folder.label',
  enabledAt: 'backup.folder.enabledAt',
  lastOkAt: 'backup.folder.lastOkAt',
  lastErrAt: 'backup.folder.lastErrAt',
  lastErr: 'backup.folder.lastErr',
  lastFile: 'backup.folder.lastFile',
} as const;
/** Files of ours kept in the folder (older ones that match our naming are deleted). */
export const FOLDER_KEEP = 7;
/** A new file at most every 20 h (one a day in practice). */
export const FOLDER_EVERY_MS = 20 * 3_600_000;
/** After a failure, wait this long before the next automatic try. */
export const FOLDER_RETRY_MS = 3 * 3_600_000;
/** Warn when there was no successful file for this many days. */
export const FOLDER_WARN_DAYS = 3;
/** iOS (no folder access): weekly reminder to save the file through the share sheet. */
export const IOS_REMIND_DAYS = 7;
/** The backup password lives in the OS keystore (SecureStore), never in the database. */
export const FOLDER_PASS_SECRET = 'folder_backup_pass_v1';
export const FOLDER_PREFIX = 'kashiro-auto-';

const pad = (n: number) => String(n).padStart(2, '0');
/** kashiro-auto-YYYY-MM-DD-HHmm.kashiro (phone's local time) — sorts by date as text. */
export function folderFileName(ms: number): string {
  const d = new Date(ms);
  return `${FOLDER_PREFIX}${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${PORTABLE_EXT}`;
}

const OURS = new RegExp(`^${FOLDER_PREFIX}(\\d{4}-\\d{2}-\\d{2}-\\d{4})(?: \\(\\d+\\))?\\.${PORTABLE_EXT}$`);

/** File name of a SAF document URI (…/document/primary%3ADownload%2FKashiro%2Fkashiro-auto-….kashiro) or a path. */
export function nameFromUri(uri: string): string {
  let s = uri;
  try {
    s = decodeURIComponent(uri);
  } catch {
    /* keep as is */
  }
  const tail = s.split('/').pop() ?? s;
  return tail.includes(':') ? tail.slice(tail.lastIndexOf(':') + 1) : tail;
}

export const isFolderBackupName = (name: string) => OURS.test(name);

/**
 * Pure: which folder entries to delete so only the newest `keep` of OUR automatic files stay. Entries are URIs or
 * names; anything not matching our naming (the shop's own files, manual exports) is never touched.
 */
export function filesToDelete(entries: string[], keep = FOLDER_KEEP): string[] {
  const ours = entries
    .map((e) => ({ e, m: OURS.exec(nameFromUri(e)) }))
    .filter((x): x is { e: string; m: RegExpExecArray } => !!x.m)
    .sort((a, b) => (a.m[1]! < b.m[1]! ? 1 : a.m[1]! > b.m[1]! ? -1 : nameFromUri(b.e).localeCompare(nameFromUri(a.e))));
  return ours.slice(Math.max(0, keep)).map((x) => x.e);
}

export interface FolderConfig {
  uri: string;
  label: string;
  enabledAt: number;
  lastOkAt: number | null;
  lastErrAt: number | null;
  lastErr: string | null;
  lastFile: string | null;
}

const num = (v: string | null) => (v ? Number(v) || null : null);

export async function getFolderConfig(db: Db): Promise<FolderConfig | null> {
  const uri = await getMeta(db, FOLDER_META.uri);
  if (!uri) return null;
  return {
    uri,
    label: (await getMeta(db, FOLDER_META.label)) ?? '',
    enabledAt: num(await getMeta(db, FOLDER_META.enabledAt)) ?? 0,
    lastOkAt: num(await getMeta(db, FOLDER_META.lastOkAt)),
    lastErrAt: num(await getMeta(db, FOLDER_META.lastErrAt)),
    lastErr: (await getMeta(db, FOLDER_META.lastErr)) || null,
    lastFile: (await getMeta(db, FOLDER_META.lastFile)) || null,
  };
}

export async function setFolder(db: Db, uri: string, label: string, now = Date.now()) {
  await setMeta(db, FOLDER_META.uri, uri);
  await setMeta(db, FOLDER_META.label, label);
  await setMeta(db, FOLDER_META.enabledAt, String(now));
  await setMeta(db, FOLDER_META.lastErr, '');
  await setMeta(db, FOLDER_META.lastErrAt, '');
}

export async function clearFolder(db: Db) {
  for (const k of [FOLDER_META.uri, FOLDER_META.label, FOLDER_META.enabledAt, FOLDER_META.lastErr, FOLDER_META.lastErrAt]) await setMeta(db, k, '');
}

export async function recordFolderResult(db: Db, r: { ok: true; at: number; file: string } | { ok: false; at: number; error: string }) {
  if (r.ok) {
    await setMeta(db, FOLDER_META.lastOkAt, String(r.at));
    await setMeta(db, FOLDER_META.lastFile, r.file);
    await setMeta(db, FOLDER_META.lastErr, '');
    await setMeta(db, FOLDER_META.lastErrAt, '');
  } else {
    await setMeta(db, FOLDER_META.lastErrAt, String(r.at));
    await setMeta(db, FOLDER_META.lastErr, r.error.slice(0, 60));
  }
}

/** Time for today's automatic file? (enabled, ≥ 20 h since the last good one, not right after a failure). */
export function folderBackupDue(c: FolderConfig | null, now = Date.now()): boolean {
  if (!c) return false;
  if (c.lastErrAt && now - c.lastErrAt < FOLDER_RETRY_MS && now >= c.lastErrAt) return false;
  return !c.lastOkAt || now - c.lastOkAt >= FOLDER_EVERY_MS || now < c.lastOkAt;
}

/** Days without a good file when that reached FOLDER_WARN_DAYS (and a try failed), else null. */
export function folderBackupWarning(c: FolderConfig | null, now = Date.now()): { days: number; error: string | null } | null {
  if (!c) return null;
  const ref = c.lastOkAt ?? c.enabledAt;
  const days = Math.floor((now - ref) / 86_400_000);
  const failed = !!c.lastErrAt && c.lastErrAt >= (c.lastOkAt ?? 0);
  return failed && days >= FOLDER_WARN_DAYS ? { days, error: c.lastErr } : null;
}

/** True when the folder backup is set up and recently good: the cloud auto backup can then run weekly instead of daily. */
export function folderBackupHealthy(c: FolderConfig | null, now = Date.now()): boolean {
  return !!c?.lastOkAt && now - c.lastOkAt < 2 * 86_400_000;
}

// ── the backup password (OS keystore) ──

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

export class FolderPassError extends Error {
  constructor(public readonly code: 'pass_short' | 'pass_mismatch') {
    super(code);
    this.name = 'FolderPassError';
  }
}

/** Validates (same rule as the manual .kashiro file) and stores the password in the keystore only. */
export async function saveFolderPassphrase(store: SecretStore, pass: string, confirm: string): Promise<void> {
  if (!portablePassphraseOk(pass)) throw new FolderPassError('pass_short');
  if (pass !== confirm) throw new FolderPassError('pass_mismatch');
  await store.set(FOLDER_PASS_SECRET, pass);
}

export const loadFolderPassphrase = (store: SecretStore) => store.get(FOLDER_PASS_SECRET);
export const forgetFolderPassphrase = (store: SecretStore) => store.del(FOLDER_PASS_SECRET);
