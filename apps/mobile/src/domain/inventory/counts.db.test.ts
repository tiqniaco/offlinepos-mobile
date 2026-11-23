import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { inventoryDocs, stockMovements } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from './seed';
import { InventoryError, type InvCtx } from './context';
import { createProduct, getProduct, type ProductInput } from './products';
import { countItem, countLines, discardCount, getOpenCount, openCount, postCount, removeCountItem, updateCountInfo } from './adjust';
import { countProgress, getCountReport, listCounts } from './counts';
import { listUnits, saveCategory } from './catalog';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const owner = SYSTEM_ROLES[0]!;
const licence: LicenceState = { mode: 'full', reason: 'ok', plan: pro.code, limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };
const user: SessionUser = { id: 'u-owner', name: 'Owner', color: '#000', roleId: 'r', roleKey: owner.key, roleName: owner.nameAr, permissions: owner.permissions, maxItemDiscountBp: owner.maxItemDiscountBp, maxInvoiceDiscountBp: owner.maxInvoiceDiscountBp, biometricEnabled: false };

let db: Db;
let ctx: InvCtx;
let clock: number;
let piece: string;
let drinks: string;
let food: string;

beforeEach(async () => {
  db = createTestDb();
  clock = 1_800_000_000_000;
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(licence);
  ctx = { db, user, device: { id: 'dev-1', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn', features: pro.features, now: () => (clock += 1000) };
  piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  drinks = await saveCategory(ctx, { name: 'مشروبات' });
  food = await saveCategory(ctx, { name: 'بقالة' });
});

let seq = 0;
const product = (name: string, costMinor: number, qtyMilli: number, categoryId: string | null) =>
  createProduct(ctx, { name, baseUnitId: piece, costMinor, retailPriceMinor: costMinor + 500, wholesalePriceMinor: costMinor + 200, trackStock: true, trackExpiry: false, lowStockMilli: null, barcodes: [`62200000${++seq}`], categoryId, openingQtyMilli: qtyMilli } as ProductInput & { openingQtyMilli: number });

describe('stock count report', () => {
  it('saves every scan, resumes the open count, and reports shortage/surplus at cost, biggest impact first', async () => {
    const tea = await product('شاي', 2000, 10_000, food); // 20.00 each
    const oil = await product('زيت', 6000, 5_000, food); // 60.00 each
    const salt = await product('ملح', 500, 4_000, food);
    const doc = await openCount(ctx, { note: '  جرد آخر الشهر ' });
    await countItem(ctx, doc, tea, 12_000, 'set'); // +2 → +40.00
    await countItem(ctx, doc, oil, 3_000, 'set'); // −2 → −120.00
    await countItem(ctx, doc, salt, 4_000, 'set'); // match
    // "Leaving and coming back": the open count is found again with its lines.
    expect(await getOpenCount(db)).toMatchObject({ id: doc, note: 'جرد آخر الشهر', categoryId: null });
    expect(await openCount(ctx, { note: 'other' })).toBe(doc);
    expect(await countLines(db, doc)).toHaveLength(3);

    const open = (await listCounts(db))[0]!;
    expect(open).toMatchObject({ id: doc, status: 'DRAFT', items: 3, shortItems: 1, surplusItems: 1, shortageMinor: 12_000, surplusMinor: 4_000, netMinor: -8_000 });
    const rep = (await getCountReport(db, doc))!;
    expect(rep.lines.map((l) => [l.name, l.kind, l.diffMilli, l.valueMinor])).toEqual([
      ['زيت', 'short', -2000, -12_000],
      ['شاي', 'surplus', 2000, 4_000],
      ['ملح', 'match', 0, 0],
    ]);

    const r = await postCount(ctx, doc);
    expect(r).toMatchObject({ changed: 2, zeroed: 0 });
    const posted = (await listCounts(db)).find((c) => c.id === doc)!;
    expect(posted).toMatchObject({ status: 'POSTED', number: r.number, shortageMinor: 12_000, surplusMinor: 4_000, items: 3 });
    expect(posted.postedAt).toBeGreaterThan(0);
    expect(await getOpenCount(db)).toBeNull();
  });

  it('partial count (one category): out-of-scope scans are refused, progress counts the scope only', async () => {
    const cola = await product('كولا', 1000, 6_000, drinks);
    const juice = await product('عصير', 1500, 4_000, drinks);
    await product('مياه', 300, 0, drinks); // in scope, no stock
    const rice = await product('رز', 3000, 9_000, food);
    const doc = await openCount(ctx, { categoryId: drinks });
    expect((await getOpenCount(db))!.categoryId).toBe(drinks);
    await countItem(ctx, doc, cola, 5_000, 'set');
    await expect(countItem(ctx, doc, rice, 1_000)).rejects.toMatchObject({ code: 'out_of_scope' });
    await expect(countItem(ctx, doc, rice, 1_000)).rejects.toBeInstanceOf(InventoryError);
    // 1 of the 3 drinks counted; juice still has stock and was not counted.
    expect(await countProgress(db, doc)).toEqual({ counted: 1, total: 3, missing: 1 });
    expect((await listCounts(db))[0]).toMatchObject({ categoryId: drinks, categoryName: 'مشروبات' });

    // Default: uncounted products keep their quantity.
    const r = await postCount(ctx, doc);
    expect(r).toMatchObject({ changed: 1, zeroed: 0 });
    expect((await getProduct(db, cola))!.level.qtyMilli).toBe(5_000);
    expect((await getProduct(db, juice))!.level.qtyMilli).toBe(4_000);
    expect((await getProduct(db, rice))!.level.qtyMilli).toBe(9_000);
  });

  it('partial count with «اعتبرهم صفر»: only the uncounted products of the category become 0', async () => {
    const cola = await product('كولا', 1000, 6_000, drinks);
    const juice = await product('عصير', 1500, 4_000, drinks);
    const rice = await product('رز', 3000, 9_000, food);
    const doc = await openCount(ctx, { categoryId: drinks });
    await countItem(ctx, doc, cola, 6_000, 'set');
    const r = await postCount(ctx, doc, { missing: 'zero' });
    expect(r).toMatchObject({ changed: 1, zeroed: 1 });
    expect((await getProduct(db, juice))!.level.qtyMilli).toBe(0);
    expect((await getProduct(db, cola))!.level.qtyMilli).toBe(6_000);
    expect((await getProduct(db, rice))!.level.qtyMilli).toBe(9_000); // other category untouched
    const rep = (await getCountReport(db, doc))!;
    expect(rep.count).toMatchObject({ items: 2, shortageMinor: 6_000, surplusMinor: 0 });
    expect(rep.lines[0]).toMatchObject({ name: 'عصير', expectedMilli: 4_000, countedMilli: 0, diffMilli: -4_000, valueMinor: -6_000, kind: 'short' });
  });

  it('discarded counts stay in the report and never touch stock; an empty one simply disappears', async () => {
    const tea = await product('شاي', 2000, 10_000, null);
    const empty = await openCount(ctx);
    await discardCount(ctx, empty);
    expect(await listCounts(db)).toEqual([]);

    const doc = await openCount(ctx, { note: 'تجربة' });
    await countItem(ctx, doc, tea, 1_000, 'set');
    await updateCountInfo(ctx, doc, { note: 'جرد الرف' });
    await discardCount(ctx, doc);
    const movesBefore = (await db.select().from(stockMovements)).length;
    expect((await listCounts(db))[0]).toMatchObject({ id: doc, status: 'DISCARDED', note: 'جرد الرف', items: 1, shortageMinor: 18_000 });
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(10_000);
    expect((await db.select().from(inventoryDocs).where(eq(inventoryDocs.id, doc)))[0]!.status).toBe('DISCARDED');
    // A new count can start; the discarded one cannot be edited any more.
    expect(await openCount(ctx)).not.toBe(doc);
    await expect(countItem(ctx, doc, tea, 1_000)).rejects.toMatchObject({ code: 'not_found' });
    await expect(removeCountItem(ctx, doc, tea)).rejects.toMatchObject({ code: 'not_found' });
    expect((await db.select().from(stockMovements)).length).toBe(movesBefore);
  });
});
