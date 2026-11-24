/**
 * Daily automatic ".kashiro" file in a folder on the shop's own storage (Android Storage Access Framework).
 * Rules / settings / rotation: domain/backup/folder.ts. Fully offline; never touches our server.
 * iOS has no lasting folder access: the backup screen shows a weekly reminder + the share sheet instead.
 */
import { Platform } from 'react-native';
import { EncodingType, StorageAccessFramework as SAF } from 'expo-file-system/legacy';
import { getDb } from '../../db/client';
import { deleteSecret, getSecret, setSecret } from '../../lib/secure';
import { recordPortableExport } from '../../domain/backup/portable';
import {
  clearFolder,
  filesToDelete,
  folderBackupDue,
  folderFileName,
  forgetFolderPassphrase,
  getFolderConfig,
  loadFolderPassphrase,
  nameFromUri,
  recordFolderResult,
  saveFolderPassphrase,
  setFolder,
  type FolderConfig,
  type SecretStore,
} from '../../domain/backup/folder';
import { buildPortableFile, type PortableStage } from './portable';
import { recordDone } from './service';

/** The OS keystore behind the folder-backup password. */
export const secureStore: SecretStore = { get: getSecret, set: setSecret, del: deleteSecret };

export const folderBackupSupported = () => Platform.OS === 'android';

export const folderConfig = () => getFolderConfig(getDb());
export const hasFolderPassphrase = async () => !!(await loadFolderPassphrase(secureStore));
export const setFolderPassphrase = (pass: string, confirm: string) => saveFolderPassphrase(secureStore, pass, confirm);

/** Readable folder name from the tree URI (…/tree/primary%3ADownload%2FKashiro → Download/Kashiro). */
export function folderLabel(treeUri: string): string {
  try {
    const t = decodeURIComponent(treeUri);
    const part = t.split('/tree/')[1] ?? t;
    const [vol, path] = part.split(':');
    const where = path ?? vol ?? '';
    return vol && vol !== 'primary' && path != null ? `${where} (${vol})` : where || nameFromUri(t);
  } catch {
    return treeUri;
  }
}

/** Opens the system folder picker (starts in Download). Returns the config, or null when the owner cancelled. */
export async function pickBackupFolder(): Promise<FolderConfig | null> {
  if (!folderBackupSupported()) return null;
  const perm = await SAF.requestDirectoryPermissionsAsync(SAF.getUriForDirectoryInRoot('Download'));
  if (!perm.granted) return null;
  await setFolder(getDb(), perm.directoryUri, folderLabel(perm.directoryUri));
  return getFolderConfig(getDb());
}

/** Turn it off (the files already in the folder stay; the password is forgotten). */
export async function disableFolderBackup() {
  await clearFolder(getDb());
  await forgetFolderPassphrase(secureStore);
}

let running: Promise<{ ok: boolean; error?: string }> | null = null;

/**
 * Write today's file into the folder and keep the newest 7 of ours. `force` = «اعمل نسخة في الفولدر دلوقتي».
 * Never throws: the result is recorded (last success / last error) for the backup screen and the warning.
 */
export function runFolderBackup(opts: { force?: boolean; onProgress?: (p: number, stage: PortableStage | 'write') => void } = {}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (running) return running;
  const p = (async () => {
    const db = getDb();
    const c = await getFolderConfig(db);
    if (!c || !folderBackupSupported()) return { ok: false, skipped: true, error: 'not_set' };
    if (!opts.force && !folderBackupDue(c)) return { ok: true, skipped: true };
    const now = Date.now();
    const pass = await loadFolderPassphrase(secureStore);
    if (!pass) {
      await recordFolderResult(db, { ok: false, at: now, error: 'no_password' });
      return { ok: false, error: 'no_password' };
    }
    const name = folderFileName(now);
    let built: Awaited<ReturnType<typeof buildPortableFile>> | null = null;
    try {
      // Photos weekly (they rarely change and dominate the size); the manual file always has them.
      const photos = opts.force || !c.lastOkAt || now - c.lastOkAt > 6 * 86_400_000 || new Date(now).getDay() === 5;
      built = await buildPortableFile(pass, name, now, opts.onProgress, { photos });
      opts.onProgress?.(1, 'write');
      let target: string;
      try {
        target = await SAF.createFileAsync(c.uri, name, 'application/octet-stream');
      } catch {
        throw new Error('folder_lost');
      }
      await SAF.writeAsStringAsync(target, await built.file.base64(), { encoding: EncodingType.Base64 });
      // Rotation: only our automatic files, newest 7 kept.
      try {
        const entries = await SAF.readDirectoryAsync(c.uri);
        for (const old of filesToDelete(entries)) await SAF.deleteAsync(old, { idempotent: true }).catch(() => undefined);
      } catch {
        /* rotation retries tomorrow */
      }
      await recordFolderResult(db, { ok: true, at: now, file: nameFromUri(target) || name });
      await recordPortableExport(db, now);
      // "Last backup" on the backup screen / the stale-backup nudge; never counts as the cloud copy.
      await recordDone({ at: now, size: built.size, id: null, kind: 'local' }, { cloudHead: false });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error && e.message === 'folder_lost' ? 'folder_lost' : 'write_failed';
      await recordFolderResult(db, { ok: false, at: now, error }).catch(() => undefined);
      return { ok: false, error };
    } finally {
      if (built?.file.exists) built.file.delete();
    }
  })().catch(() => ({ ok: false, error: 'write_failed' }));
  running = p.finally(() => {
    running = null;
  });
  return running;
}
