import { beforeEach, describe, expect, it } from 'vitest';
import { businessDay, DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { partyBalance } from './customers';
import { countParties, listParties, saveParty } from './parties';
import { customersDue, partyDue } from './statement';
import { createPartyWithOpening, listVouchers, postVoucher, type VoucherCtx } from '../vouchers/vouchers';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner, , cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic = (): LicenceState => ({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user = (role = owner): SessionUser => ({ id: `u-${role.key}`, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false });
const TZ = 'Africa/Cairo';

let db: Db;
let clock: number;
let ctx: VoucherCtx;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = { db, user: user(), device: { id: 'dev-1', code: 'A' }, timezone: TZ, now: () => (clock += 1000) };
});

describe('parties', () => {
  it('rejects a mobile that is not a valid number; accepts and normalises a valid one', async () => {
    await expect(saveParty(ctx, 'C', { name: 'أحمد', mobile: '12345' })).rejects.toMatchObject({ code: 'mobile_invalid' });
    const id = await saveParty(ctx, 'C', { name: 'أحمد', mobile: '1012345678' });
    expect((await listParties(db, 'C'))[0]).toMatchObject({ id, mobile: '201012345678' });
  });

  it('creates the party and its opening balance together, or neither', async () => {
    const id = await createPartyWithOpening(ctx, 'S', { name: 'مورد' }, { amountMinor: 5000, sign: 1 });
    expect(await partyBalance(db, 'S', id)).toBe(-5000);
    expect(await listVouchers(db, { types: ['OPENING_BALANCE'] })).toHaveLength(1);
    // A cashier may add customers but not suppliers: nothing is written.
    await expect(createPartyWithOpening({ ...ctx, user: user(cashier) }, 'S', { name: 'تاني' }, { amountMinor: 100, sign: 1 })).rejects.toThrow();
    expect(await countParties(db, 'S')).toBe(1);
    // Opening balance for a supplier needs purchases.manage, not parties.manage.
    await expect(postVoucher({ ...ctx, user: user(cashier) }, { type: 'OPENING_BALANCE', partyType: 'S', partyId: id, amountMinor: 100, method: 'credit' })).rejects.toThrow();
  });

  it('counts with the same search/filter as the list', async () => {
    const a = await saveParty(ctx, 'C', { name: 'سارة' });
    await saveParty(ctx, 'C', { name: 'محمود' });
    await postVoucher(ctx, { type: 'OPENING_BALANCE', partyType: 'C', partyId: a, amountMinor: 1000, method: 'credit' });
    expect(await countParties(db, 'C')).toBe(2);
    expect(await countParties(db, 'C', { filter: 'owing' })).toBe(1);
    expect(await countParties(db, 'C', { search: 'محمود' })).toBe(1);
  });

  it('partyDue agrees with customersDue for one customer', async () => {
    const a = await createPartyWithOpening(ctx, 'C', { name: 'سارة' }, { amountMinor: 1000, sign: 1 });
    const b = await saveParty(ctx, 'C', { name: 'محمود' });
    const today = businessDay(clock, TZ) + 3;
    const all = await customersDue(db, today);
    expect(await partyDue(db, a, today)).toMatchObject({ balanceMinor: 1000, days: all.find((x) => x.id === a)!.days });
    expect(await partyDue(db, b, today)).toBeNull();
  });
});
