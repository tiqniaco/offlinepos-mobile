import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { withTx } from '../../db/tx';
import { setLicenceState } from '../licence/guard';
import { insertUser, seedSystemRoles, unlockWithPin, updateUser } from './users';

describe('licence limits on users', () => {
  it('re-activating a disabled user counts against the plan user limit', async () => {
    const basic = DEFAULT_PLANS.find((p) => p.code === 'basic')!;
    setLicenceState({ mode: 'full', reason: 'ok', plan: 'basic', limits: { ...basic.limits, users: 2 }, features: basic.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
    const db = createTestDb();
    const now = Date.UTC(2026, 10, 23);
    const { owner, cashier, roles } = await withTx(db, async (tx) => {
      const roles = await seedSystemRoles(tx, { deviceId: 'd', deviceCode: 'A', now });
      const owner = await insertUser(tx, { name: 'أحمد', password: 'Shop2026ok', roleId: roles.owner, createdBy: null, deviceId: 'd', deviceCode: 'A', now, colorIndex: 0 });
      const cashier = await insertUser(tx, { name: 'كريم', pin: '2580', roleId: roles.cashier, createdBy: owner, deviceId: 'd', deviceCode: 'A', now: now + 1, colorIndex: 1 });
      return { owner, cashier, roles };
    });
    const actor = await unlockWithPin(db, owner, 'Shop2026ok');
    const device = { id: 'd', code: 'A' };
    await updateUser(db, actor, cashier, { isActive: false }, device);
    // The freed seat is taken by someone else…
    await withTx(db, (tx) => insertUser(tx, { name: 'سارة', pin: '1470', roleId: roles.cashier, createdBy: owner, deviceId: 'd', deviceCode: 'A', now: now + 2, colorIndex: 2 }));
    // …so bringing the old cashier back would exceed the plan.
    await expect(updateUser(db, actor, cashier, { isActive: true }, device)).rejects.toMatchObject({ reason: 'limit' });
  });
});
