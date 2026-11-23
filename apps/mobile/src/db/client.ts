/**
 * Opens the encrypted database and runs migrations. The ONLY place that touches PRAGMA key.
 * See docs/data-model.md.
 */
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import { drizzle, type ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import migrations from './migrations/migrations';
import * as schema from './schema';
import { getOrCreateDbKey } from '../lib/secure';

export const DB_NAME = 'daftarak.db';
export type AppDb = ExpoSQLiteDatabase<typeof schema>;

let sqlite: SQLite.SQLiteDatabase | null = null;
let db: AppDb | null = null;

export class DbNotEncryptedError extends Error {}

export async function openDatabase(): Promise<AppDb> {
  if (db) return db;
  const conn = SQLite.openDatabaseSync(DB_NAME);
  // Refuse to run without SQLCipher: otherwise PRAGMA key is silently ignored and data is stored in clear.
  const cipher = conn.getFirstSync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!cipher) {
    conn.closeSync();
    throw new DbNotEncryptedError('SQLCipher is not available in this build');
  }
  try {
    const key = await getOrCreateDbKey();
    // Raw 256-bit key: no KDF needed (the key is random, not a password) → fast open.
    conn.execSync(`PRAGMA key = "x'${key}'"`);
    conn.execSync('PRAGMA journal_mode = WAL');
    conn.execSync('PRAGMA foreign_keys = ON');
    // Fails here (not later) if the key is wrong or the file is corrupt.
    conn.getFirstSync('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    try {
      conn.closeSync();
    } catch {
      /* already unusable */
    }
    throw e;
  }
  sqlite = conn;
  db = drizzle(conn, { schema });
  try {
    await migrate(db, migrations);
  } catch (e) {
    closeDatabase(); // a retry must run the migrations again, not reuse a half-migrated handle
    throw e;
  }
  return db;
}

export function getDb(): AppDb {
  if (!db) throw new Error('database not opened');
  return db;
}

export function getSqlite(): SQLite.SQLiteDatabase {
  if (!sqlite) throw new Error('database not opened');
  return sqlite;
}

/** Close the live database (restore replaces the file, then openDatabase() is called again). */
export function closeDatabase() {
  sqlite?.closeSync();
  sqlite = null;
  db = null;
}

/**
 * Set the database file aside (renamed, NEVER deleted: a damaged file may still be recoverable by support) so the
 * app can start empty and restore from a backup. Returns the new base name.
 */
export function moveDatabaseAside(tag: string): string {
  closeDatabase();
  const dir = new Directory(Paths.document, 'SQLite');
  const base = `${DB_NAME}.${tag}-${Date.now()}`;
  for (const suffix of ['', '-wal', '-shm']) {
    const f = new File(dir, DB_NAME + suffix);
    if (f.exists) f.moveSync(new File(dir, base + suffix));
  }
  return base;
}
