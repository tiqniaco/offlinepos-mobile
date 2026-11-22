/**
 * Creates a fresh in-memory SQLite database with all app migrations applied (Node / Vitest only).
 * Uses better-sqlite3 through Drizzle's sync driver — the same execution model as expo-sqlite on the
 * phone, so transaction behaviour in tests matches the app.
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../db/schema';
import type { Db } from '../db/types';

export function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '../db/migrations') });
  return db as unknown as Db;
}
