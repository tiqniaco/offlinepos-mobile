import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test/testDb';
import { getMeta } from '../device';
import { kvMeta } from '../../db/schema';
import {
  FOLDER_KEEP,
  FOLDER_PASS_SECRET,
  FolderPassError,
  clearFolder,
  filesToDelete,
  folderBackupDue,
  folderBackupHealthy,
  folderBackupWarning,
  folderFileName,
  getFolderConfig,
  isFolderBackupName,
  loadFolderPassphrase,
  nameFromUri,
  recordFolderResult,
  saveFolderPassphrase,
  setFolder,
  forgetFolderPassphrase,
  type SecretStore,
} from './folder';

const H = 3_600_000;
const D = 24 * H;
const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADownload%2FKashiro';
const doc = (name: string) => `${TREE}/document/primary%3ADownload%2FKashiro%2F${encodeURIComponent(name)}`;

function memoryStore(): SecretStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), del: async (k) => void data.delete(k) };
}

describe('folder backup: file names & rotation (pure)', () => {
  it('names sort by date and are recognised; other files are not ours', () => {
    const n = folderFileName(new Date(2026, 10, 24, 9, 5).getTime());
    expect(n).toBe('kashiro-auto-2026-11-24-0905.kashiro');
    expect(isFolderBackupName(n)).toBe(true);
    expect(isFolderBackupName('kashiro-auto-2026-11-24-0905 (1).kashiro')).toBe(true);
    expect(isFolderBackupName('kashiro-2026-11-24.kashiro')).toBe(false); // a manual export
    expect(isFolderBackupName('photo.jpg')).toBe(false);
    expect(nameFromUri(doc(n))).toBe(n);
  });

  it('keeps the newest 7 of ours and never touches other files', () => {
    const ours = Array.from({ length: 10 }, (_, i) => doc(folderFileName(new Date(2026, 10, 1 + i, 8, 0).getTime())));
    const others = [doc('kashiro-2026-11-02.kashiro'), doc('notes.txt'), doc('kashiro-auto-broken.kashiro')];
    const shuffled = [...ours.slice(5), ...others, ...ours.slice(0, 5)];
    const del = filesToDelete(shuffled);
    expect(del).toHaveLength(10 - FOLDER_KEEP);
    expect(del.sort()).toEqual(ours.slice(0, 3).sort()); // the three oldest
    for (const o of others) expect(del).not.toContain(o);
    expect(filesToDelete(ours.slice(0, 7))).toEqual([]);
    expect(filesToDelete(ours, 0)).toHaveLength(10);
  });
});

describe('folder backup: settings, due & warning (kv_meta)', () => {
  it('config round-trip; due daily; retry pause after a failure; warning after 3 days of failures', async () => {
    const db = createTestDb();
    expect(await getFolderConfig(db)).toBeNull();
    expect(folderBackupDue(null)).toBe(false);
    const t0 = Date.UTC(2026, 10, 24, 8);
    await setFolder(db, TREE, 'Download/Kashiro', t0);
    let c = await getFolderConfig(db);
    expect(c).toMatchObject({ uri: TREE, label: 'Download/Kashiro', enabledAt: t0, lastOkAt: null });
    expect(folderBackupDue(c, t0)).toBe(true);

    await recordFolderResult(db, { ok: true, at: t0, file: 'kashiro-auto-2026-11-24-1000.kashiro' });
    c = await getFolderConfig(db);
    expect(folderBackupDue(c, t0 + 10 * H)).toBe(false);
    expect(folderBackupDue(c, t0 + 21 * H)).toBe(true);
    expect(folderBackupHealthy(c, t0 + 1 * D)).toBe(true);
    expect(folderBackupWarning(c, t0 + 5 * D)).toBeNull(); // no failure recorded: nothing to warn about

    await recordFolderResult(db, { ok: false, at: t0 + 1 * D, error: 'folder_lost' });
    c = await getFolderConfig(db);
    expect(folderBackupDue(c, t0 + 1 * D + H)).toBe(false); // waits a few hours after a failure
    expect(folderBackupDue(c, t0 + 1 * D + 4 * H)).toBe(true);
    expect(folderBackupWarning(c, t0 + 2 * D)).toBeNull();
    expect(folderBackupWarning(c, t0 + 3 * D + H)).toEqual({ days: 3, error: 'folder_lost' });
    expect(folderBackupHealthy(c, t0 + 3 * D)).toBe(false);

    await recordFolderResult(db, { ok: true, at: t0 + 4 * D, file: 'x' });
    expect(folderBackupWarning(await getFolderConfig(db), t0 + 4 * D + H)).toBeNull();

    await clearFolder(db);
    expect(await getFolderConfig(db)).toBeNull();
  });
});

describe('folder backup: the password goes to the keystore only', () => {
  it('validates, stores in the secret store, never in the database', async () => {
    const db = createTestDb();
    const store = memoryStore();
    await expect(saveFolderPassphrase(store, 'short', 'short')).rejects.toBeInstanceOf(FolderPassError);
    await expect(saveFolderPassphrase(store, 'Shop2026ok', 'Shop2026no')).rejects.toMatchObject({ code: 'pass_mismatch' });
    expect(store.data.size).toBe(0);
    await saveFolderPassphrase(store, 'Shop2026ok', 'Shop2026ok');
    expect(store.data.get(FOLDER_PASS_SECRET)).toBe('Shop2026ok');
    expect(await loadFolderPassphrase(store)).toBe('Shop2026ok');
    await setFolder(db, TREE, 'Download/Kashiro');
    await recordFolderResult(db, { ok: true, at: Date.now(), file: 'f' });
    const rows = await db.select().from(kvMeta);
    expect(JSON.stringify(rows)).not.toContain('Shop2026ok');
    expect(await getMeta(db, 'backup.folder.uri')).toBe(TREE);
    await forgetFolderPassphrase(store);
    expect(await loadFolderPassphrase(store)).toBeNull();
  });
});
