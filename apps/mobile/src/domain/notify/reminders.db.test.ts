import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, SYSTEM_ROLES, addDays, businessDay, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { setLicenceState } from '../licence/guard';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { saveParty } from '../parties/parties';
import { cartLineFor, postSale } from '../sales/sales';
import { postPurchase, purchaseLineFor } from '../purchases/purchases';
import { computeReminders, summaryLines } from './reminders';

describe('morning summary', () => {
  it('counts late customers, supplier dues and stock alerts', async () => {
    const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
    setLicenceState({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null } as LicenceState);
    const db = createTestDb();
    let clock = Date.UTC(2026, 9, 1, 8);
    await ensureInventorySeed(db, { id: 'd', code: 'A' }, clock);
    const o = SYSTEM_ROLES[0]!;
    const ctx = { db, user: { id: 'u', name: 'o', color: '#000', roleId: 'r', roleKey: o.key, roleName: o.nameAr, permissions: o.permissions, maxItemDiscountBp: 0, maxInvoiceDiscountBp: 0, biometricEnabled: false }, device: { id: 'd', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 }, vatRegistered: false, vatRateBp: 0 };
    const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
    const a = await createProduct(ctx, { name: 'a', baseUnitId: piece, costMinor: 100, retailPriceMinor: 1000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [], openingQtyMilli: 3000, lowStockMilli: 5000 });
    await createProduct(ctx, { name: 'b', baseUnitId: piece, costMinor: 100, retailPriceMinor: 1000, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [], openingQtyMilli: 0, lowStockMilli: 2000 });
    const c = await saveParty(ctx, 'C', { name: 'late' });
    const s = await saveParty(ctx, 'S', { name: 'sup' });
    await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, a, null, 'retail', 1000)], priceTier: 'retail', customerId: c }, [{ method: 'credit', amountMinor: 1000 }]);
    await postPurchase(ctx, { supplierId: s, lines: [await purchaseLineFor(db, ctx, a, null, 1000)], pricesIncludeVat: true, dueDays: 30 }, [{ method: 'credit', amountMinor: 100 }]);
    const later = addDays(businessDay(clock, 'Africa/Cairo'), 40);
    const r = await computeReminders(db, later, 30);
    expect(r).toMatchObject({ lateCustomers: 1, lateAmountMinor: 1000, supplierDue: 1, supplierDueMinor: 100, outOfStock: 1, lowStock: 1 });
    expect(summaryLines(r, (k) => k, String)).toEqual(['notify.late', 'notify.supplierDue', 'notify.out', 'notify.low']);
    expect((await computeReminders(db, businessDay(clock, 'Africa/Cairo'), 30)).lateCustomers).toBe(0);
  });
});
