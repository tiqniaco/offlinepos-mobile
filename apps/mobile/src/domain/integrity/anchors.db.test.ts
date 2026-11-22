import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { canonicalJson, utf8ToBytes, ed25519Sign, base64urlEncode, DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { setLicenceState } from '../licence/guard';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { cartLineFor, postSale } from '../sales/sales';
import { currentAnchor, saveReceipt, verifyAnchors } from './anchors';
import { chainHash, GENESIS_HASH } from '@daftarak/shared';

// The DEV server key (apps/api/.dev.vars.example) — matches the DEV public key the app accepts in development.
const DEV_SK = 'bdca3b0e965fb5ecdd5386590a59525cd5c38f8065094415a15228ad22272a48';
const sign = (deviceId: string, a: { chainSeq: number; chainHead: string; auditSeq: number; auditHead: string }, serverTime: number) =>
  base64urlEncode(ed25519Sign(utf8ToBytes(canonicalJson({ t: 'anchor', deviceId, ...a, serverTime })), DEV_SK));

describe('server anchors', () => {
  it('a rooted phone that rewrites history AND recomputes every hash is still caught by an older anchor', async () => {
    const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
    setLicenceState({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null } as LicenceState);
    const db = createTestDb();
    let clock = Date.UTC(2026, 10, 22, 8);
    await ensureInventorySeed(db, { id: 'd1', code: 'A' }, clock);
    const o = SYSTEM_ROLES[0]!;
    const ctx = { db, user: { id: 'u', name: 'o', color: '#000', roleId: 'r', roleKey: o.key, roleName: o.nameAr, permissions: o.permissions, maxItemDiscountBp: 0, maxInvoiceDiscountBp: 0, biometricEnabled: false }, device: { id: 'd1', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 } };
    const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
    const p = await createProduct(ctx, { name: 'x', baseUnitId: piece, costMinor: 1, retailPriceMinor: 1000, wholesalePriceMinor: 0, trackStock: false, trackExpiry: false, barcodes: [] });
    for (let i = 0; i < 3; i++) await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, p, null, 'retail', 1000)], priceTier: 'retail' }, [{ method: 'cash', amountMinor: 1000 }]);
    const a = await currentAnchor(db, 'd1');
    await saveReceipt(db, 'd1', { ...a, serverTime: clock, sig: sign('d1', a, clock) });
    expect((await verifyAnchors(db, 'd1')).mismatch).toBeNull();
    // forged receipt
    await saveReceipt(db, 'd1', { ...a, chainSeq: a.chainSeq, serverTime: clock + 1, sig: sign('d1', { ...a, chainHead: 'f'.repeat(64) }, clock + 1) });
    expect((await verifyAnchors(db, 'd1')).mismatch?.kind).toBe('signature');
    await db.run(sql`DELETE FROM anchor_receipts WHERE server_time = ${clock + 1}`);
    // Attacker rewrites the chain completely (recomputed hashes, consistent links) — local check would pass…
    for (const t of (await db.all(sql`SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'integrity_chain'`)) as { name: string }[]) await db.run(sql.raw(`DROP TRIGGER ${t.name}`));
    const rows = (await db.all(sql`SELECT chain_seq FROM integrity_chain WHERE device_id = 'd1' ORDER BY chain_seq`)) as { chain_seq: number }[];
    let prev = GENESIS_HASH;
    for (const r of rows) {
      const h = chainHash({ forged: r.chain_seq }, prev);
      await db.run(sql`UPDATE integrity_chain SET hash = ${h}, prev_hash = ${prev} WHERE device_id = 'd1' AND chain_seq = ${r.chain_seq}`);
      prev = h;
    }
    // …but the anchored head at that sequence no longer matches.
    expect((await verifyAnchors(db, 'd1')).mismatch).toMatchObject({ kind: 'chain', chainSeq: a.chainSeq });
  });
});
