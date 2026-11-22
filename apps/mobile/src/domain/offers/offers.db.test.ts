import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { businessDay, DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { trialBalance } from '../accounting/journal';
import { verifyChain } from '../integrity/chain';
import { cartLineFor, getSale, postSale, SalesError, type SalesCtx } from '../sales/sales';
import { loadOffers, saveOffer, OfferError } from './offers';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const free = DEFAULT_PLANS.find((p) => p.code === 'free')!;
const [owner, , cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic = (plan = pro): LicenceState => ({ mode: 'full', reason: 'ok', plan: plan.code, limits: plan.limits, features: plan.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user = (role = owner): SessionUser => ({ id: `u-${role.key}`, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false });

let db: Db;
let ctx: SalesCtx;
let clock: number;
let tea: string;
let day: number;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  day = businessDay(clock, 'Africa/Cairo');
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = { db, user: user(), device: { id: 'dev-1', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn', features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 } };
  const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1000, retailPriceMinor: 2000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['1'], openingQtyMilli: 100_000 });
});

const draft = async (qty: number, couponCode?: string) => ({ lines: [await cartLineFor(db, ctx.settings, tea, null, 'retail', qty)], priceTier: 'retail' as const, couponCode });

describe('offers at posting', () => {
  it('re-applies the best offer + coupon inside the posting transaction and stores them', async () => {
    await saveOffer(ctx, { name: 'شاي 10%', type: 'PERCENT', active: true, scope: { productIds: [tea] }, valueBp: 1000 });
    await saveOffer(ctx, { name: '2+1', type: 'BUY_X_GET_Y', active: true, scope: { productIds: [tea] }, buyQtyMilli: 2000, getQtyMilli: 1000, valueBp: 10_000 });
    await saveOffer(ctx, { name: 'كوبون', type: 'COUPON', active: true, scope: { all: true }, couponCode: 'eid', valueMinor: 500, maxUses: 1 });
    // 3 × 20 = 60: 2+1 saves 20 (best), coupon 5 → 35
    const r = await postSale(ctx, await draft(3000, 'EID'), [{ method: 'cash', amountMinor: 3500 }]);
    expect(r.totalMinor).toBe(3500);
    const s = (await getSale(db, r.docId))!;
    expect(s.doc).toMatchObject({ offerDiscountMinor: 2000, couponCode: 'EID', couponDiscountMinor: 500 });
    expect(s.lines[0]).toMatchObject({ offerDiscountMinor: 2000 });
    expect(s.lines[0]!.offerId).toBeTruthy();
    expect([...(await trialBalance(db)).values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
    // max uses = 1 → second use refused
    await expect(postSale(ctx, await draft(1000, 'EID'), [{ method: 'cash', amountMinor: 2000 }])).rejects.toMatchObject({ code: 'coupon_invalid', detail: { reason: 'used_up' } });
    expect((await loadOffers(db)).find((o) => o.type === 'COUPON')!.usedCount).toBe(1);
  });

  it('a cashier with 0% caps can sell at an offer price (offers are not manual discounts)', async () => {
    await saveOffer(ctx, { name: '20%', type: 'PERCENT', active: true, scope: { all: true }, valueBp: 2000 });
    const c = { ...ctx, user: { ...user(cashier), maxItemDiscountBp: 0, maxInvoiceDiscountBp: 0 } };
    const r = await postSale(c, await draft(1000), [{ method: 'cash', amountMinor: 1600 }]);
    expect(r.totalMinor).toBe(1600);
  });

  it('expired offers and plans without offers do not apply', async () => {
    await saveOffer(ctx, { name: 'old', type: 'PERCENT', active: true, scope: { all: true }, valueBp: 5000, endsDay: day - 1 });
    expect((await postSale(ctx, await draft(1000), [{ method: 'cash', amountMinor: 2000 }])).totalMinor).toBe(2000);
    await saveOffer(ctx, { name: 'now', type: 'PERCENT', active: true, scope: { all: true }, valueBp: 5000 });
    setLicenceState(lic(free));
    expect(await loadOffers(db)).toEqual([]);
    expect((await postSale(ctx, await draft(1000), [{ method: 'cash', amountMinor: 2000 }])).totalMinor).toBe(2000);
    await expect(saveOffer(ctx, { name: 'x', type: 'PERCENT', active: true, scope: { all: true }, valueBp: 100 })).rejects.toThrow();
  });

  it('validation, unique coupon codes, cashier cannot manage offers', async () => {
    await expect(saveOffer(ctx, { name: '', type: 'PERCENT', active: true, scope: {}, valueBp: 0 })).rejects.toBeInstanceOf(OfferError);
    await saveOffer(ctx, { name: 'a', type: 'COUPON', active: true, scope: { all: true }, couponCode: 'X1', valueBp: 100 });
    await expect(saveOffer(ctx, { name: 'b', type: 'COUPON', active: true, scope: { all: true }, couponCode: 'x1', valueBp: 100 })).rejects.toMatchObject({ code: 'code_taken' });
    await expect(saveOffer({ ...ctx, user: user(cashier) }, { name: 'c', type: 'PERCENT', active: true, scope: { all: true }, valueBp: 100 })).rejects.toThrow();
  });

  it('offer amounts on a posted invoice cannot be edited; tampering breaks the chain', async () => {
    await saveOffer(ctx, { name: '10%', type: 'PERCENT', active: true, scope: { all: true }, valueBp: 1000 });
    const r = await postSale(ctx, await draft(2000), [{ method: 'cash', amountMinor: 3600 }]);
    const err = async (q: ReturnType<typeof sql>) => {
      try {
        await db.run(q);
        return 'ok';
      } catch (e) {
        return String((e as { cause?: Error }).cause?.message ?? (e as Error).message);
      }
    };
    expect(await err(sql`UPDATE sales_docs SET coupon_discount_minor = 999 WHERE id = ${r.docId}`)).toMatch(/immutable/);
    await db.run(sql`DROP TRIGGER sales_docs_offers_immutable`);
    await db.run(sql`UPDATE sales_docs SET offer_discount_minor = 1 WHERE id = ${r.docId}`);
    expect((await verifyChain(db, 'dev-1')).firstBreak).toMatchObject({ reason: 'hash_mismatch' });
    void SalesError;
  });
});
