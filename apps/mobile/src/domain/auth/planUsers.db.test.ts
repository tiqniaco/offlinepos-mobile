import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { withTx } from '../../db/tx';
import { setLicenceState } from '../licence/guard';
import { insertUser, seedSystemRoles, unlockWithPin, usersAllowedByPlan } from './users';

const free = DEFAULT_PLANS.find((p) => p.code === 'free')!;
const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const state = (plan: typeof free) => setLicenceState({ mode: plan.isFree ? 'free' : 'full', reason: 'ok', plan: plan.code, limits: plan.limits, features: plan.features, canWrite: true, showAds: plan.isFree, trialDaysLeft: null, graceDaysLeft: null });

describe('staff above the plan user limit are paused', () => {
  it('after the trial ends on the free plan only the owner unlocks; upgrading brings everyone back', async () => {
    const db = createTestDb();
    const now = Date.UTC(2026, 10, 23);
    const { owner, cashier } = await withTx(db, async (tx) => {
      const roles = await seedSystemRoles(tx, { deviceId: 'd', deviceCode: 'A', now });
      // The cashier is created first on purpose: owners still take the seat.
      const cashier = await insertUser(tx, { name: 'كريم', pin: '2580', roleId: roles.cashier, createdBy: null, deviceId: 'd', deviceCode: 'A', now, colorIndex: 1 });
      const owner = await insertUser(tx, { name: 'أحمد', password: 'Shop2026ok', roleId: roles.owner, createdBy: null, deviceId: 'd', deviceCode: 'A', now: now + 1, colorIndex: 0 });
      return { owner, cashier };
    });
    state(free);
    expect([...(await usersAllowedByPlan(db))]).toEqual([owner]);
    await expect(unlockWithPin(db, cashier, '2580')).rejects.toMatchObject({ code: 'plan_limit' });
    expect((await unlockWithPin(db, owner, 'Shop2026ok')).id).toBe(owner);
    state(pro);
    expect((await unlockWithPin(db, cashier, '2580')).id).toBe(cashier);
  });
});
