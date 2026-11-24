/**
 * «النسخ التلقائي على Google Drive»: the owner signs in with Google once; the app creates a «Kashiro Backups» folder
 * in THEIR Drive and uploads the password-protected .kashiro file every day (newest 14 kept).
 * Scope drive.file: the app sees only the files it created itself — never the rest of the owner's Drive.
 * Our server is not involved. Needs EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (Google Cloud, see docs).
 */
import { Platform } from 'react-native';
import { FileSystemUploadType, uploadAsync } from 'expo-file-system/legacy';
import { getDb } from '../../db/client';
import { getMeta, setMeta } from '../../domain/device';
import { folderFileName, loadFolderPassphrase } from '../../domain/backup/folder';
import { buildPortableFile } from './portable';
import { secureStore } from './folderBackup';
import { recordDone } from './service';
import { withLockHold } from '../../state/lockHold';

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';
export const DRIVE_FOLDER_NAME = 'Kashiro Backups';
const KEEP = 14;
const DAY = 86_400_000;
const K = { email: 'drive.email', folder: 'drive.folderId', ok: 'drive.lastOkAt', err: 'drive.lastError', at: 'drive.lastTryAt' };
const API = 'https://www.googleapis.com';

export const driveAvailable = () => Platform.OS === 'android' && !!WEB_CLIENT_ID;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const gsi = (): typeof import('@react-native-google-signin/google-signin') => require('@react-native-google-signin/google-signin');
let configured = false;
function google() {
  const { GoogleSignin } = gsi();
  if (!configured) {
    GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ['https://www.googleapis.com/auth/drive.file'], offlineAccess: false });
    configured = true;
  }
  return GoogleSignin;
}

export interface DriveState {
  email: string | null;
  lastOkAt: number | null;
  lastError: string | null;
}
export async function driveState(): Promise<DriveState> {
  const db = getDb();
  return { email: await getMeta(db, K.email), lastOkAt: Number((await getMeta(db, K.ok)) ?? 0) || null, lastError: await getMeta(db, K.err) };
}

async function token(): Promise<string> {
  const g = google();
  if (!g.hasPreviousSignIn()) throw new Error('drive_signed_out');
  const s = await g.signInSilently();
  if (s.type !== 'success') throw new Error('drive_signed_out');
  return (await g.getTokens()).accessToken;
}

async function call<T>(tk: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (res.status === 401 || res.status === 403) throw new Error('drive_denied');
  if (!res.ok) throw new Error(`drive_http_${res.status}`);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const q = (s: string) => encodeURIComponent(s);

/** The «Kashiro Backups» folder this app created (found again after a reinstall), or a new one. */
async function ensureFolder(tk: string): Promise<string> {
  const db = getDb();
  const known = await getMeta(db, K.folder);
  if (known) {
    const f = await call<{ id: string; trashed?: boolean }>(tk, `/drive/v3/files/${known}?fields=id,trashed`).catch(() => null);
    if (f && !f.trashed) return known;
  }
  const found = await call<{ files: { id: string }[] }>(
    tk,
    `/drive/v3/files?q=${q(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`)}&fields=files(id)&spaces=drive`,
  );
  const id =
    found.files[0]?.id ??
    (await call<{ id: string }>(tk, '/drive/v3/files?fields=id', { method: 'POST', body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }) })).id;
  await setMeta(db, K.folder, id);
  return id;
}

/** «اربط Google Drive»: Google's own sign-in sheet, then the folder. Returns the account e-mail, or null if cancelled. */
export async function connectDrive(): Promise<string | null> {
  const g = google();
  await g.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const r = await withLockHold(() => g.signIn());
  if (r.type !== 'success') return null;
  const tk = (await g.getTokens()).accessToken;
  await ensureFolder(tk);
  await setMeta(getDb(), K.email, r.data.user.email);
  await setMeta(getDb(), K.err, '');
  return r.data.user.email;
}

export async function disconnectDrive() {
  const db = getDb();
  try {
    await google().signOut();
  } catch {
    /* already signed out */
  }
  for (const k of [K.email, K.folder, K.ok, K.err]) await setMeta(db, k, '');
}

let running: Promise<{ ok: boolean; error?: string; skipped?: boolean }> | null = null;

/** Today's file to Drive (once a day; `force` = «ارفع نسخة دلوقتي»). Never throws; the result is shown on the backup screen. */
export function runDriveBackup(opts: { force?: boolean } = {}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  if (running) return running;
  const p = (async () => {
    const db = getDb();
    if (!driveAvailable() || !(await getMeta(db, K.email))) return { ok: false, skipped: true, error: 'not_set' };
    const now = Date.now();
    const last = Number((await getMeta(db, K.ok)) ?? 0);
    if (!opts.force && now - last < DAY - 3_600_000) return { ok: true, skipped: true };
    const lastTry = Number((await getMeta(db, K.at)) ?? 0);
    if (!opts.force && now - lastTry < 3 * 3_600_000) return { ok: false, skipped: true };
    await setMeta(db, K.at, String(now));
    const pass = await loadFolderPassphrase(secureStore);
    if (!pass) {
      await setMeta(db, K.err, 'no_password');
      return { ok: false, error: 'no_password' };
    }
    let built: Awaited<ReturnType<typeof buildPortableFile>> | null = null;
    try {
      const tk = await token();
      const folder = await ensureFolder(tk);
      const name = folderFileName(now);
      built = await buildPortableFile(pass, name, now, undefined, { photos: true });
      // Resumable upload: metadata first, then the bytes straight from the file (no copy in JS memory).
      const init = await fetch(`${API}/upload/drive/v3/files?uploadType=resumable&fields=id`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream' },
        body: JSON.stringify({ name, parents: [folder], appProperties: { kashiro: 'backup' } }),
      });
      const loc = init.headers.get('Location');
      if (!init.ok || !loc) throw new Error(`drive_http_${init.status}`);
      const up = await uploadAsync(loc, built.file.uri, { httpMethod: 'PUT', uploadType: FileSystemUploadType.BINARY_CONTENT, headers: { 'Content-Type': 'application/octet-stream' } });
      if (up.status < 200 || up.status >= 300) throw new Error(`drive_http_${up.status}`);
      // Keep the newest 14 of ours.
      const list = await call<{ files: { id: string }[] }>(
        tk,
        `/drive/v3/files?q=${q(`'${folder}' in parents and trashed=false and appProperties has { key='kashiro' and value='backup' }`)}&orderBy=createdTime desc&fields=files(id)&pageSize=100`,
      ).catch(() => ({ files: [] }));
      for (const f of list.files.slice(KEEP)) await call(tk, `/drive/v3/files/${f.id}`, { method: 'DELETE' }).catch(() => undefined);
      await setMeta(db, K.ok, String(now));
      await setMeta(db, K.err, '');
      await recordDone({ at: now, size: built.size, id: null, kind: 'local' }, { cloudHead: false });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error && /^drive_/.test(e.message) ? e.message : 'drive_failed';
      await setMeta(db, K.err, error).catch(() => undefined);
      return { ok: false, error };
    } finally {
      if (built?.file.exists) built.file.delete();
    }
  })().catch(() => ({ ok: false, error: 'drive_failed' }));
  running = p.finally(() => {
    running = null;
  });
  return running;
}
