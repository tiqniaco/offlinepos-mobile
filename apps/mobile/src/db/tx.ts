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

// "Figures changed" signal: postings mark the running transaction; listeners hear about it only after COMMIT
// (home summary refresh). Kept here so every posting path is covered without touching each screen.
let changed = false;
const listeners = new Set<() => void>();
/** Call inside a transaction that posts/voids a document or moves stock or money. */
export function markDataChanged() {
  changed = true;
}
export function onDataCommitted(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function withTx<T>(db: Db, fn: (tx: Db) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    await db.run(sql`BEGIN IMMEDIATE`);
    changed = false;
    try {
      const result = await fn(db);
      await db.run(sql`COMMIT`);
      if (changed) {
        changed = false;
        for (const l of listeners) {
          try {
            l();
          } catch {
            /* a listener never breaks a committed posting */
          }
        }
      }
      return result;
    } catch (e) {
      changed = false;
      await db.run(sql`ROLLBACK`);
      throw e;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}
