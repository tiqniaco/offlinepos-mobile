import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * The database type domain code works with. Driver-agnostic so the same services run on the phone
 * (expo-sqlite, sync driver) and in Node integration tests (libsql, async driver).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = BaseSQLiteDatabase<'sync' | 'async', any, typeof schema>;
