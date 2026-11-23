import { describe, expect, it } from 'vitest';
import { DEFAULT_PLANS } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import { setLicenceState } from '../licence/guard';
import { withTx } from '../../db/tx';
import { insertUser, listActiveUsers, seedSystemRoles, syncOwnerPassword, unlockWithPin, updateUser, PinError } from './users';

async function setup() {
  const db = createTestDb();
  const now = Date.UTC(2026, 10, 23);
  const ids = await withTx(db, async (tx) => {
    const roleIds = await seedSystemRoles(tx, { deviceId: 'd', deviceCode: 'A', now });
    const owner = await insertUser(tx, { name: 'أحمد', password: 'Shop2026ok', roleId: roleIds.owner, createdBy: null, deviceId: 'd', deviceCode: 'A', now, colorIndex: 0 });
    const cashier = await insertUser(tx, { name: 'كريم', pin: '2580', roleId: roleIds.cashier, createdBy: owner, deviceId: 'd', deviceCode: 'A', now: now + 1, colorIndex: 1 });
    return { owner, cashier, roleIds };
  });
  return { db, ...ids };
}

describe('owner unlocks with the account password, staff with a PIN', () => {
  it('kinds, unlock, wrong password, weak password refused', async () => {
    const { db, owner, cashier, roleIds } = await setup();
    const users = await listActiveUsers(db);
    expect(users.find((u) => u.id === owner)!.secretKind).toBe('password');
    expect(users.find((u) => u.id === cashier)!.secretKind).toBe('pin');
    expect((await unlockWithPin(db, owner, 'Shop2026ok')).secretKind).toBe('password');
    expect((await unlockWithPin(db, cashier, '2580')).secretKind).toBe('pin');
    await expect(unlockWithPin(db, owner, 'shop2026ok')).rejects.toBeInstanceOf(PinError);
    await expect(withTx(db, (tx) => insertUser(tx, { name: 'x', password: 'abc', roleId: roleIds.owner, createdBy: null, deviceId: 'd', deviceCode: 'A', now: 1, colorIndex: 2 }))).rejects.toMatchObject({ code: 'password_weak' });
  });

  it('a new password (changed or reset online) replaces the old one on this phone and clears the lock-out', async () => {
    const { db, owner, cashier } = await setup();
    for (let i = 0; i < 5; i++) await unlockWithPin(db, owner, `Wrong${i}pass1`).catch(() => undefined);
    await expect(unlockWithPin(db, owner, 'Shop2026ok')).rejects.toMatchObject({ code: 'locked' });
    expect(await syncOwnerPassword(db, 'New2027pass', 'd')).toBe(owner);
    await expect(unlockWithPin(db, owner, 'Shop2026ok')).rejects.toMatchObject({ code: 'wrong' });
    expect((await unlockWithPin(db, owner, 'New2027pass')).id).toBe(owner);
    expect((await unlockWithPin(db, cashier, '2580')).id).toBe(cashier); // staff PIN untouched
    expect(await syncOwnerPassword(db, 'weak', 'd')).toBeNull();
  });

  it('an older install whose owner used a PIN switches to the password', async () => {
    const db = createTestDb();
    const owner = await withTx(db, async (tx) => {
      const r = await seedSystemRoles(tx, { deviceId: 'd', deviceCode: 'A', now: 1 });
      return insertUser(tx, { name: 'قديم', pin: '2580', roleId: r.owner, createdBy: null, deviceId: 'd', deviceCode: 'A', now: 1, colorIndex: 0 });
    });
    await syncOwnerPassword(db, 'Shop2026ok', 'd');
    expect((await listActiveUsers(db))[0]!.secretKind).toBe('password');
    expect((await unlockWithPin(db, owner, 'Shop2026ok')).id).toBe(owner);
  });

  it('a PIN cannot be set on a password user (owner); staff PINs still change', async () => {
    const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
    setLicenceState({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
    const { db, owner, cashier } = await setup();
    const actor = await unlockWithPin(db, owner, 'Shop2026ok');
    const device = { id: 'd', code: 'A' };
    await expect(updateUser(db, actor, owner, { pin: '2468' }, device)).rejects.toThrow('password_user');
    expect((await unlockWithPin(db, owner, 'Shop2026ok')).id).toBe(owner);
    await updateUser(db, actor, cashier, { pin: '1357' }, device);
    expect((await unlockWithPin(db, cashier, '1357')).id).toBe(cashier);
  });
});
