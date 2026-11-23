import { describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { integrityChain } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { chainCheckpoint, verifyChain, verifyChainSinceCheckpoint } from './chain';
import { onDataCommitted } from '../../db/tx';

async function setup() {
  const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
  setLicenceState({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null } as LicenceState);
  const db = createTestDb();
  await ensureInventorySeed(db, { id: 'd', code: 'A' }, 1);
  const o = SYSTEM_ROLES[0]!;
  const ctx = { db, user: { id: 'u', name: 'o', color: '#000', roleId: 'r', roleKey: o.key, roleName: o.nameAr, permissions: o.permissions, maxItemDiscountBp: 0, maxInvoiceDiscountBp: 0, biometricEnabled: false }, device: { id: 'd', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features };
  const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  let n = 0;
  const add = () => createProduct(ctx, { name: `p${++n}`, baseUnitId: piece, costMinor: 100, retailPriceMinor: 150, wholesalePriceMinor: 140, trackStock: true, trackExpiry: false, barcodes: [], openingQtyMilli: 5000 });
  return { db, add };
}

describe('daily integrity check from a checkpoint', () => {
  it('verifies only new entries and moves the checkpoint to the last verified one', async () => {
    const { db, add } = await setup();
    for (let i = 0; i < 3; i++) await add();
    const first = await verifyChainSinceCheckpoint(db, 'd');
    expect(first).toMatchObject({ ok: true, count: 3 });
    expect(await chainCheckpoint(db, 'd')).toMatchObject({ seq: 3 });
    await add();
    const second = await verifyChainSinceCheckpoint(db, 'd');
    expect(second).toMatchObject({ ok: true, count: 4 });
    expect(await chainCheckpoint(db, 'd')).toMatchObject({ seq: 4, hash: second.head });
  });

  it('a changed checkpoint entry falls back to the full check (and the break is found)', async () => {
    const { db, add } = await setup();
    for (let i = 0; i < 3; i++) await add();
    await verifyChainSinceCheckpoint(db, 'd');
    await db.run(sql`DROP TRIGGER integrity_chain_no_update`); // a rooted phone could bypass it
    await db.update(integrityChain).set({ hash: 'f'.repeat(64) }).where(and(eq(integrityChain.deviceId, 'd'), eq(integrityChain.chainSeq, 3)));
    const r = await verifyChainSinceCheckpoint(db, 'd');
    expect(r.ok).toBe(false);
    expect((await verifyChain(db, 'd')).ok).toBe(false);
  });

  it('a new entry that does not link to the checkpoint is reported', async () => {
    const { db, add } = await setup();
    for (let i = 0; i < 2; i++) await add();
    await verifyChainSinceCheckpoint(db, 'd');
    await add();
    await db.run(sql`DROP TRIGGER integrity_chain_no_update`);
    await db.run(sql`UPDATE integrity_chain SET prev_hash = ${'0'.repeat(64)} WHERE device_id = 'd' AND chain_seq = 3`);
    expect((await verifyChainSinceCheckpoint(db, 'd')).firstBreak).toMatchObject({ seq: 3, reason: 'link' });
  });

  it('postings notify listeners after commit (home summary refresh)', async () => {
    const { add } = await setup();
    let n = 0;
    const off = onDataCommitted(() => n++);
    await add();
    off();
    await add();
    expect(n).toBe(1);
  });
});
