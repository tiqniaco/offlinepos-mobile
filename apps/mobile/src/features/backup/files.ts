/**
 * Device-side backup files (PLAN.md §9.2–9.4). Heavy work runs in small slices with a yield between them, so the
 * UI never freezes (acceptance: main-thread blocks < 100 ms). Plain-text temporary files are deleted right away.
 */
import { Directory, File, Paths, UploadTask, DownloadTask, UploadType } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { base64urlDecode, ObkReader, ObkWriter, readObkHeader, type ObkHeader } from '@daftarak/shared';
import { getSqlite, DB_NAME } from '../../db/client';

// 64 KB per slice: ≈ 7 ms in Node, ~25–40 ms expected on Hermes — far below the 100 ms freeze budget.
const SLICE = 64 * 1024;
const yieldUi = () => new Promise<void>((r) => setTimeout(r, 0));
const IMAGES = 'product-images';

export function backupDir(): Directory {
  const d = new Directory(Paths.cache, 'backups');
  if (!d.exists) d.create({ idempotent: true, intermediates: true });
  return d;
}

function fresh(dir: Directory, name: string): File {
  const f = new File(dir, name);
  if (f.exists) f.delete();
  f.create();
  return f;
}

/** Consistent plain-text copy of the live encrypted DB (SQLCipher export inside one read transaction). */
function snapshot(target: File) {
  if (target.exists) target.delete();
  const path = decodeURIComponent(target.uri.replace(/^file:\/\//, ''));
  const db = getSqlite();
  db.execSync(`ATTACH DATABASE '${path.replace(/'/g, "''")}' AS bk KEY ''`);
  try {
    db.execSync(`SELECT sqlcipher_export('bk')`);
  } finally {
    db.execSync(`DETACH DATABASE bk`);
  }
}

export interface BuiltBackup {
  file: File;
  size: number;
  sha256: string;
}

/** Snapshot → .obk (gzip + AES-256-GCM with the business backup key). Progress 0…1. */
export async function buildBackup(keyB64: string, header: ObkHeader, onProgress?: (p: number) => void): Promise<BuiltBackup> {
  return writeBackupFile(new ObkWriter(base64urlDecode(keyB64), header), `backup-${header.createdAt}.obk`, [], onProgress);
}

/**
 * Snapshot + product photos (+ small extra entries) through any container writer (cloud .obk or portable .kashiro),
 * in 64 KB slices with a yield between them. Progress 0…1.
 */
export async function writeBackupFile(w: ObkWriter<object>, fileName: string, extras: [string, Uint8Array][], onProgress?: (p: number) => void): Promise<BuiltBackup> {
  const dir = backupDir();
  const plain = new File(dir, 'snapshot.sqlite');
  snapshot(plain);
  const out = fresh(dir, fileName);
  const outH = out.open();
  const fileHash = sha256.create();
  const write = async (chunks: Uint8Array[]) => {
    for (const c of chunks) {
      fileHash.update(c);
      await outH.writeBytes(c);
    }
  };
  try {
    await write([w.start()]);
    const inH = plain.open();
    const total = inH.size ?? 0;
    await write(w.beginEntry('db.sqlite', total));
    for (let done = 0; done < total; ) {
      const b = await inH.readBytes(SLICE);
      if (!b.length) break;
      await write(w.data(b));
      done += b.length;
      onProgress?.(Math.min(0.95, (done / Math.max(1, total)) * 0.9));
      await yieldUi();
    }
    inH.close();
    // Product photos travel in the same file (owner decision Q-08).
    const imgDir = new Directory(Paths.document, IMAGES);
    if (imgDir.exists) {
      for (const f of imgDir.list()) {
        if (!(f instanceof File)) continue;
        const bytes = await f.bytes();
        await write(w.beginEntry(`img/${f.name}`, bytes.length));
        await write(w.data(bytes));
        await yieldUi();
      }
    }
    for (const [name, bytes] of extras) {
      await write(w.beginEntry(name, bytes.length));
      await write(w.data(bytes));
    }
    const fin = w.finish();
    await write(fin.frames);
  } finally {
    outH.close();
    if (plain.exists) plain.delete();
  }
  onProgress?.(1);
  return { file: out, size: out.size ?? 0, sha256: bytesToHex(fileHash.digest()) };
}

export async function uploadBackup(file: File, put: { url: string; headers: Record<string, string> }) {
  const task = new UploadTask(file, put.url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers: put.headers });
  const r = await task.uploadAsync();
  if (r.status < 200 || r.status >= 300) throw new Error(`upload ${r.status}`);
}

export async function downloadBackup(url: string, onProgress?: (p: number) => void): Promise<File> {
  const dest = fresh(backupDir(), 'restore.obk');
  const task = new DownloadTask(url, dest);
  void onProgress;
  await task.downloadAsync();
  return dest;
}

export async function backupHeader(file: File): Promise<ObkHeader> {
  const h = file.open();
  try {
    return readObkHeader(await h.readBytes(64 * 1024)).header;
  } finally {
    h.close();
  }
}

/** Decrypt a .obk into a plain snapshot + staged images. Throws ObkError on wrong key / tampering. */
export async function decryptBackup(file: File, keyB64: string, onProgress?: (p: number) => void): Promise<{ snapshot: File; images: Directory; header: ObkHeader }> {
  const out = await decryptBackupFile<ObkHeader>(file, base64urlDecode(keyB64), onProgress);
  return { snapshot: out.snapshot, images: out.images, header: out.header };
}

/** Small entries under "key/" are returned in memory (never written to disk). */
export async function decryptBackupFile<H extends object>(
  file: File,
  key: Uint8Array,
  onProgress?: (p: number) => void,
): Promise<{ snapshot: File; images: Directory; header: H; secrets: Record<string, Uint8Array> }> {
  const dir = backupDir();
  const snap = fresh(dir, 'restore.sqlite');
  const imgStage = new Directory(dir, 'restore-images');
  if (imgStage.exists) imgStage.delete();
  imgStage.create({ intermediates: true });
  const snapH = snap.open();
  let cur: { name: string; handle: ReturnType<File['open']> | null } = { name: '', handle: null };
  const pending: Promise<void>[] = [];
  const secrets: Record<string, Uint8Array> = {};
  const r = new ObkReader<H>(key, {
    onEntry: (name) => {
      if (cur.handle && cur.handle !== snapH) cur.handle.close();
      if (name === 'db.sqlite') cur = { name, handle: snapH };
      else if (name.startsWith('img/')) cur = { name, handle: fresh(imgStage, name.slice(4).replace(/[^\w.-]/g, '_')).open() };
      else cur = { name, handle: null };
    },
    onData: (d) => {
      if (cur.handle) cur.handle.writeBytesSync(d.slice());
      else if (cur.name.startsWith('key/') && d.length) {
        const prev = secrets[cur.name];
        const next = new Uint8Array((prev?.length ?? 0) + d.length);
        if (prev) next.set(prev);
        next.set(d, prev?.length ?? 0);
        if (next.length <= 1024) secrets[cur.name] = next;
      }
    },
  });
  const inH = file.open();
  const total = inH.size ?? 0;
  let failed = false;
  try {
    for (let done = 0; done < total; ) {
      const b = await inH.readBytes(SLICE);
      if (!b.length) break;
      r.push(b);
      done += b.length;
      onProgress?.(done / Math.max(1, total));
      await yieldUi();
    }
    await Promise.all(pending);
    r.finish();
  } catch (e) {
    failed = true;
    throw e;
  } finally {
    inH.close();
    if (cur.handle && cur.handle !== snapH) cur.handle.close();
    snapH.close();
    // Wrong key / damaged file: no partly decrypted data stays behind.
    if (failed) {
      if (snap.exists) snap.delete();
      if (imgStage.exists) imgStage.delete();
    }
  }
  return { snapshot: snap, images: imgStage, header: r.header!, secrets };
}

/** Open a decrypted snapshot read-only-ish for the preview (no key: it is the plain copy). */
export function openSnapshot(snapshot: File): SQLite.SQLiteDatabase {
  const dir = snapshot.parentDirectory.uri;
  return SQLite.openDatabaseSync(snapshot.name, undefined, dir.replace(/^file:\/\//, ''));
}

/**
 * Replace the live DB with the snapshot, encrypted with THIS phone's DB key. The caller closes the current
 * connection first and reopens with openDatabase() afterwards (migrations run there).
 */
export function installSnapshot(snapshot: File, dbKeyHex: string, images: Directory) {
  const sqliteDir = new Directory(Paths.document, 'SQLite');
  const target = new File(sqliteDir, 'restore-new.db');
  if (target.exists) target.delete();
  const conn = SQLite.openDatabaseSync('restore-new.db');
  conn.execSync(`PRAGMA key = "x'${dbKeyHex}'"`);
  const src = decodeURIComponent(snapshot.uri.replace(/^file:\/\//, ''));
  conn.execSync(`ATTACH DATABASE '${src.replace(/'/g, "''")}' AS src KEY ''`);
  conn.execSync(`SELECT sqlcipher_export('main', 'src')`);
  conn.execSync('DETACH DATABASE src');
  conn.closeSync();
  for (const suffix of ['', '-wal', '-shm']) {
    const f = new File(sqliteDir, DB_NAME + suffix);
    if (f.exists) f.delete();
  }
  target.move(new File(sqliteDir, DB_NAME));
  snapshot.delete();
  // Photos
  const live = new Directory(Paths.document, IMAGES);
  if (!live.exists) live.create({ intermediates: true });
  for (const f of images.list()) if (f instanceof File) f.move(new File(live, f.name));
  images.delete();
}
