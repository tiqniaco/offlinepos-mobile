/**
 * Async-safe transactions.
 *
 * Why: Drizzle's expo-sqlite driver implements `db.transaction(fn)` synchronously — with an async `fn`
 * it COMMITS before the awaited statements run, so nothing would be atomic and errors would not roll back.
 * `withTx` runs BEGIN IMMEDIATE … COMMIT/ROLLBACK around an async function on the same connection and
 * serialises writers through a queue so two user actions never interleave inside one transaction.
 *
 * Rules: never call withTx inside withTx (it would wait for itself). Functions that take a `tx`
 * parameter must not start their own transaction.
 */
import { sql } from 'drizzle-orm';
import type { Db } from './types';

let queue: Promise<unknown> = Promise.resolve();

export function withTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    await db.run(sql`BEGIN IMMEDIATE`);
    try {
      const result = await fn(db);
      await db.run(sql`COMMIT`);
      return result;
    } catch (e) {
      await db.run(sql`ROLLBACK`);
      throw e;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
