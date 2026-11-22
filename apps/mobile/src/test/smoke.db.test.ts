import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb } from './testDb';
import { withTx } from '../db/tx';
import { kvMeta } from '../db/schema';

describe('test database', () => {
  it('applies all migrations incl. FTS5 and triggers', async () => {
    const db = createTestDb();
    const t = await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name`);
    const names = t.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['products', 'stock_movements', 'products_fts', 'stock_movements_no_update', 'audit_log_no_delete']));
  });
  it('withTx rolls back everything on error', async () => {
    const db = createTestDb();
    await expect(
      withTx(db, async (tx) => {
        await tx.insert(kvMeta).values({ key: 'a', value: '1' });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.select().from(kvMeta)).toEqual([]);
  });
  it('withTx serialises concurrent writers', async () => {
    const db = createTestDb();
    await Promise.all(Array.from({ length: 10 }, (_, i) => withTx(db, async (tx) => { await tx.insert(kvMeta).values({ key: `k${i}`, value: String(i) }); })));
    expect((await db.select().from(kvMeta)).length).toBe(10);
  });
});
