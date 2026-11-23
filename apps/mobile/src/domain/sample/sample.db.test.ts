import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { setLicenceState } from '../licence/guard';
import { ensureInventorySeed } from '../inventory/seed';
import { listProducts, findByBarcode } from '../inventory/products';
import { listParties } from '../parties/parties';
import { addSampleData, hasSampleData, removeSampleData } from './sample';

describe('sample data', () => {
  it('adds products/customers/suppliers with barcodes and removes exactly them', async () => {
    const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
    setLicenceState({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null } as LicenceState);
    const db = createTestDb();
    await ensureInventorySeed(db, { id: 'd', code: 'A' }, 1);
    const o = SYSTEM_ROLES[0]!;
    const ctx = { db, user: { id: 'u', name: 'o', color: '#000', roleId: 'r', roleKey: o.key, roleName: o.nameAr, permissions: o.permissions, maxItemDiscountBp: 0, maxInvoiceDiscountBp: 0, biometricEnabled: false }, device: { id: 'd', code: 'A' }, timezone: 'Africa/Cairo', negativeStock: 'warn' as const, features: pro.features };
    expect(await addSampleData(ctx, 'SAR')).toBe(19);
    expect(await hasSampleData(ctx)).toBe(true);
    expect((await listProducts(db, { limit: 100 })).length).toBe(19);
    expect(await findByBarcode(db, '6220001000011')).not.toBeNull();
    // Opening stock: a first test sale must not go negative.
    expect((await listProducts(db, { limit: 100 })).every((p) => p.qtyMilli === 20_000)).toBe(true);
    expect((await listParties(db, 'C')).length).toBe(3);
    await removeSampleData(ctx);
    expect(await hasSampleData(ctx)).toBe(false);
    expect((await listProducts(db, { limit: 100 })).length).toBe(0);
    expect((await listParties(db, 'S')).length).toBe(0);
  });
});
