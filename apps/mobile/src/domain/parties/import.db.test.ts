import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PLANS, guessPartyMapping, partyImportTemplateAr, SYSTEM_ROLES, validatePartyRows, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { partyBalance } from './customers';
import { getParty, listParties, saveParty } from './parties';
import { importParties } from './import';
import { importExpenseCategories, listExpenseCategories, listVouchers, saveExpenseCategory, type VoucherCtx } from '../vouchers/vouchers';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner, , cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic = (): LicenceState => ({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user = (role = owner): SessionUser => ({ id: `u-${role.key}`, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false });

let db: Db;
let clock: number;
let ctx: VoucherCtx;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = { db, user: user(), device: { id: 'dev-1', code: 'A' }, timezone: 'Africa/Cairo', now: () => (clock += 1000) };
});

const rowsOf = (type: 'C' | 'S', cells: unknown[][]) => {
  const headers = partyImportTemplateAr(type).headers;
  return validatePartyRows(cells, guessPartyMapping(headers)).valid;
};

describe('party import', () => {
  it('creates customers with their opening balance through the normal posting', async () => {
    const rows = rowsOf('C', [
      ['محمود', '01012345678', 'المنصورة', '', '', '', 2000, 350],
      ['سارة', '', '', '', '', '', '', -50],
      ['منى'],
    ]);
    const r = await importParties(ctx, 'C', rows, { updateExisting: false });
    expect(r).toMatchObject({ created: 3, updated: 0, skippedExisting: 0, failed: [] });
    const list = await listParties(db, 'C');
    const mahmoud = list.find((p) => p.name === 'محمود')!;
    expect(mahmoud).toMatchObject({ mobile: '201012345678', creditLimitMinor: 200_000 });
    expect(await partyBalance(db, 'C', mahmoud.id)).toBe(35_000);
    expect(await partyBalance(db, 'C', list.find((p) => p.name === 'سارة')!.id)).toBe(-5_000);
    expect(await listVouchers(db, { types: ['OPENING_BALANCE'] })).toHaveLength(2);
  });

  it('skips or updates an existing phone, and never posts a second opening balance', async () => {
    const id = await saveParty(ctx, 'S', { name: 'شركة قديمة', mobile: '01112345678', address: 'العبور', notes: 'قديم' });
    const rows = rowsOf('S', [['شركة النور', '1112345678', '', '', '', 'جديد', 900]]);
    const skip = await importParties(ctx, 'S', rows, { updateExisting: false });
    expect(skip).toMatchObject({ created: 0, skippedExisting: 1 });
    expect((await getParty(db, 'S', id))!.name).toBe('شركة قديمة');

    const upd = await importParties(ctx, 'S', rows, { updateExisting: true });
    expect(upd).toMatchObject({ created: 0, updated: 1, openingIgnored: 1 });
    const p = (await getParty(db, 'S', id))!;
    // Filled cells replace, empty cells keep what was saved.
    expect(p).toMatchObject({ name: 'شركة النور', address: 'العبور', notes: 'جديد' });
    expect(await partyBalance(db, 'S', id)).toBe(0);
    expect(await listVouchers(db, { types: ['OPENING_BALANCE'] })).toHaveLength(0);
  });

  it('needs the same permission as the form (a cashier cannot import suppliers)', async () => {
    const rows = rowsOf('S', [['مورد']]);
    await expect(importParties({ ...ctx, user: user(cashier) }, 'S', rows, { updateExisting: false })).rejects.toThrow();
    expect(await listParties(db, 'S')).toHaveLength(0);
  });
});

describe('expense category import', () => {
  it('adds new names only', async () => {
    await saveExpenseCategory(ctx, { name: 'إيجار' });
    const r = await importExpenseCategories(ctx, ['إيجار', 'كهربا', ' كهربا', 'صيانة']);
    expect(r).toEqual({ created: 2, skipped: 2 });
    expect((await listExpenseCategories(db)).map((c) => c.name).sort()).toEqual(['إيجار', 'صيانة', 'كهربا'].sort());
  });
});
