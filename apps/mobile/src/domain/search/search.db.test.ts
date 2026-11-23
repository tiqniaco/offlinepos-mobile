import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { setLicenceState } from '../licence/guard';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct } from '../inventory/products';
import { saveParty } from '../parties/parties';
import { cartLineFor, postSale } from '../sales/sales';
import { searchAll } from './search';

describe('global search', () => {
  it('finds products (name, Arabic variants, barcode), customers, suppliers and invoices', async () => {
    const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
    setLicenceState({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null } as LicenceState);
    const db = createTestDb();
    let clock = Date.UTC(2026, 10, 23, 8);
    await ensureInventorySeed(db, { id: 'd', code: 'A' }, clock);
    const o = SYSTEM_ROLES[0]!;
    const ctx = { db, user: { id: 'u', name: 'o', color: '#000', roleId: 'r', roleKey: o.key, roleName: o.nameAr, permissions: o.permissions, maxItemDiscountBp: 0, maxInvoiceDiscountBp: 0, biometricEnabled: false }, device: { id: 'd', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features, now: () => (clock += 1000), settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 } };
    const piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
    const p = await createProduct(ctx, { name: 'شاي العروسة', baseUnitId: piece, costMinor: 1, retailPriceMinor: 2200, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: ['6221234567890'], openingQtyMilli: 5000 });
    const c = await saveParty(ctx, 'C', { name: 'أحمد علي', mobile: '01012345678' });
    await saveParty(ctx, 'S', { name: 'شركة الأمل' });
    const sale = await postSale(ctx, { lines: [await cartLineFor(db, ctx.settings, p, null, 'retail', 1000)], priceTier: 'retail', customerId: c, customerName: 'أحمد علي' }, [{ method: 'cash', amountMinor: 2200 }]);
    expect((await searchAll(db, 'شاى')).products.map((x) => x.id)).toEqual([p]); // ى ≈ ي
    expect((await searchAll(db, '6221234567890')).products[0]?.id).toBe(p);
    expect((await searchAll(db, 'احمد')).customers[0]?.id).toBe(c); // أ ≈ ا
    expect((await searchAll(db, '٠١٠١٢')).customers[0]?.id).toBe(c); // Arabic digits
    expect((await searchAll(db, 'الامل')).suppliers).toHaveLength(1);
    expect((await searchAll(db, sale.number.slice(-6))).invoices[0]?.id).toBe(sale.docId);
    expect(await searchAll(db, '  ')).toMatchObject({ products: [], invoices: [] });
  });
});
