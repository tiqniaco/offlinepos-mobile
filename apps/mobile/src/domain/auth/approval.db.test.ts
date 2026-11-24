import { beforeEach, describe, expect, it } from 'vitest';
import { asc } from 'drizzle-orm';
import { DEFAULT_PLANS, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { auditLog, salesDocs } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import { verifyAuditRows } from '../audit/audit';
import { changeSetting } from '../settings/settings';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { bulkChangePrices, createProduct, deleteProduct, getProduct, updateProduct, type ProductInput } from '../inventory/products';
import { cartLineFor, postReturn, postSale, returnableLines, voidSale, type SalesCtx } from '../sales/sales';
import { insertUser, seedSystemRoles, sessionAfterSetup, PinError, type SessionUser } from './users';
import { approveWithPin, ApprovalError, DEFAULT_APPROVAL_POLICY, needsApproval, policyNeeds, resolvePolicy, __issueForTest } from './approval';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const lic: LicenceState = { mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null };

let db: Db;
let ctx: SalesCtx;
let clock: number;
let tea: string;
let piece: string;
let ids: { owner: string; manager: string; cashier: string; manager2: string };
let as: Record<'owner' | 'manager' | 'cashier', SessionUser>;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 24, 8, 0, 0);
  setLicenceState(lic);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  ids = await withTx(db, async (tx) => {
    const r = await seedSystemRoles(tx, { deviceId: 'dev-1', deviceCode: 'A', now: clock });
    const owner = await insertUser(tx, { name: 'أحمد', password: 'Shop2026ok', roleId: r.owner!, createdBy: null, deviceId: 'dev-1', deviceCode: 'A', now: clock, colorIndex: 0 });
    const manager = await insertUser(tx, { name: 'منى', pin: '4826', roleId: r.manager!, createdBy: owner, deviceId: 'dev-1', deviceCode: 'A', now: clock + 1, colorIndex: 1 });
    const cashier = await insertUser(tx, { name: 'كريم', pin: '2580', roleId: r.cashier!, createdBy: owner, deviceId: 'dev-1', deviceCode: 'A', now: clock + 2, colorIndex: 2 });
    const manager2 = await insertUser(tx, { name: 'سمير', pin: '7193', roleId: r.manager!, createdBy: owner, deviceId: 'dev-1', deviceCode: 'A', now: clock + 3, colorIndex: 3 });
    return { owner, manager, cashier, manager2 };
  });
  as = { owner: await sessionAfterSetup(db, ids.owner), manager: await sessionAfterSetup(db, ids.manager), cashier: await sessionAfterSetup(db, ids.cashier) };
  ctx = {
    db,
    user: as.owner,
    device: { id: 'dev-1', code: 'A' },
    timezone: 'Africa/Cairo',
    negativeStock: 'warn',
    features: pro.features,
    now: () => (clock += 1000),
    settings: { pricesIncludeVat: true, vatRegistered: false, vatRateBp: 0 },
  };
  piece = (await listUnits(db)).find((u) => u.nameAr === 'قطعة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 20_000, retailPriceMinor: 30_000, wholesalePriceMinor: 28_000, trackStock: true, trackExpiry: false, barcodes: ['111'], openingQtyMilli: 100_000 });
});

const sell = async (qtyMilli: number) => {
  const line = await cartLineFor(db, ctx.settings, tea, null, 'retail', qtyMilli);
  return postSale(ctx, { lines: [line], priceTier: 'retail' }, [{ method: 'cash', amountMinor: line.unitPriceMinor * (qtyMilli / 1000) }]);
};
const audits = async (action: string) => (await db.select().from(auditLog).orderBy(asc(auditLog.seq))).filter((a) => a.action === action);
const input = (retail: number): ProductInput => ({ name: 'شاي', baseUnitId: piece, costMinor: 20_000, retailPriceMinor: retail, wholesalePriceMinor: 28_000, trackStock: true, trackExpiry: false, barcodes: ['111'] });

describe('policy', () => {
  it('defaults: void, delete, export/restore on; returns over 500 on; price change off; owner never asked', () => {
    expect(DEFAULT_APPROVAL_POLICY).toEqual({ void: true, returnOver: true, returnOverMinor: 50_000, productDelete: true, priceChange: false, exportData: true });
    const p = resolvePolicy(undefined);
    expect(policyNeeds(p, { roleKey: 'manager' }, 'void')).toBe(true);
    expect(policyNeeds(p, { roleKey: 'owner' }, 'void')).toBe(false);
    expect(policyNeeds(p, { roleKey: 'cashier' }, 'return', 50_000)).toBe(false);
    expect(policyNeeds(p, { roleKey: 'cashier' }, 'return', 50_001)).toBe(true);
    expect(policyNeeds(p, { roleKey: 'manager' }, 'priceChange')).toBe(false);
    expect(policyNeeds(p, { roleKey: 'manager' }, 'restore')).toBe(true);
    expect(resolvePolicy({ priceChange: true, returnOverMinor: -5 })).toMatchObject({ priceChange: true, returnOverMinor: 50_000, void: true });
  });
  it('a missing own permission always needs approval (even with the policy off)', () => {
    const off = resolvePolicy({ void: false });
    expect(needsApproval(off, as.cashier, 'void', { permission: 'doc.void' })).toBe(true);
    expect(needsApproval(off, as.manager, 'void', { permission: 'doc.void' })).toBe(false);
  });
  it('the policy is shop-wide: changing it needs settings.manage', async () => {
    await expect(changeSetting(db, 'managerApproval', { void: false }, { userId: as.cashier.id, deviceId: 'dev-1', permissions: as.cashier.permissions })).rejects.toThrow('missing permission settings.manage');
    await changeSetting(db, 'managerApproval', { ...DEFAULT_APPROVAL_POLICY, void: false }, { userId: as.owner.id, deviceId: 'dev-1', permissions: as.owner.permissions });
    const inv = await sell(1000);
    await voidSale({ ...ctx, user: as.manager }, inv.docId, 'غلط'); // no approval needed any more
  });
});

describe('approveWithPin', () => {
  it('right PIN → single-use token; wrong PIN → lock-out rules; cashier cannot approve', async () => {
    await expect(approveWithPin(db, ids.manager2, '0000', 'void')).rejects.toBeInstanceOf(PinError);
    await expect(approveWithPin(db, ids.cashier, '2580', 'void')).rejects.toMatchObject({ code: 'no_right' });
    const r = await approveWithPin(db, ids.manager2, '7193', 'void');
    expect(r.approval.userId).toBe(ids.manager2);
    expect(r.user.roleKey).toBe('manager');
  });
});

describe('enforced in the domain', () => {
  it('void: a manager needs another approval; token is checked, used once, logged by the approver', async () => {
    const inv = await sell(1000);
    const m = { ...ctx, user: as.manager };
    await expect(voidSale(m, inv.docId, 'غلط')).rejects.toMatchObject({ code: 'approval_required', action: 'void' });
    await expect(voidSale(m, inv.docId, 'غلط', { approvedBy: { userId: ids.manager2, token: 'forged' } })).rejects.toMatchObject({ code: 'approval_invalid' });
    // Token for another action is refused.
    const wrong = (await approveWithPin(db, ids.manager2, '7193', 'productDelete')).approval;
    await expect(voidSale(m, inv.docId, 'غلط', { approvedBy: wrong })).rejects.toMatchObject({ code: 'approval_invalid' });
    // Not by themselves.
    await expect(voidSale(m, inv.docId, 'غلط', { approvedBy: (await approveWithPin(db, ids.manager, '4826', 'void')).approval })).rejects.toMatchObject({ code: 'no_right' });
    const ok = (await approveWithPin(db, ids.manager2, '7193', 'void')).approval;
    await voidSale(m, inv.docId, 'غلط', { approvedBy: ok });
    const [a] = await audits('approval.void');
    expect(a).toMatchObject({ userId: ids.manager2, entity: 'sales_docs', entityId: inv.docId });
    expect(JSON.parse(a!.afterJson!)).toMatchObject({ for: ids.manager });
    // Used once.
    const inv2 = await sell(1000);
    await expect(voidSale(m, inv2.docId, 'غلط', { approvedBy: ok })).rejects.toMatchObject({ code: 'approval_invalid' });
    expect(verifyAuditRows(await db.select().from(auditLog).orderBy(asc(auditLog.seq))).ok).toBe(true);
  });

  it('void: owner is never asked; a cashier can void only with a manager (not another cashier)', async () => {
    const inv = await sell(1000);
    const c = { ...ctx, user: as.cashier };
    await expect(voidSale(c, inv.docId, 'غلط')).rejects.toThrow('missing permission doc.void');
    await expect(voidSale(c, inv.docId, 'غلط', { approvedBy: __issueForTest(as.cashier, 'void') })).rejects.toMatchObject({ code: 'no_right' });
    await voidSale(c, inv.docId, 'غلط', { approvedBy: (await approveWithPin(db, ids.manager, '4826', 'void')).approval });
    const doc = (await db.select().from(salesDocs)).find((d) => d.id === inv.docId)!;
    expect(doc.status).toBe('VOIDED');
    const inv2 = await sell(1000);
    await voidSale(ctx, inv2.docId, 'owner');
    expect(await audits('approval.void')).toHaveLength(1);
  });

  it('return above the threshold needs a manager; below it does not', async () => {
    const inv = await sell(3000); // 900.00
    const line = (await returnableLines(db, inv.docId))[0]!;
    const c = { ...ctx, user: as.cashier };
    await postReturn(c, inv.docId, [{ lineId: line.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 30_000 }], 'x'); // 300 ≤ 500
    await expect(postReturn(c, inv.docId, [{ lineId: line.lineId, qtyMilli: 2000 }], [{ method: 'cash', amountMinor: 60_000 }], 'x')).rejects.toMatchObject({ code: 'approval_required', action: 'return' });
    await postReturn(c, inv.docId, [{ lineId: line.lineId, qtyMilli: 2000 }], [{ method: 'cash', amountMinor: 60_000 }], 'x', { approvedBy: (await approveWithPin(db, ids.manager, '4826', 'return')).approval });
    const [a] = await audits('approval.return');
    expect(JSON.parse(a!.afterJson!)).toMatchObject({ for: ids.cashier, amount: 60_000 });
  });

  it('delete product needs a manager for a manager; price change only when switched on', async () => {
    const m = { ...ctx, user: as.manager };
    await expect(deleteProduct(m, tea)).rejects.toBeInstanceOf(ApprovalError);
    // Price change: off by default → the manager edits freely.
    await updateProduct(m, tea, input(31_000));
    await changeSetting(db, 'managerApproval', { ...DEFAULT_APPROVAL_POLICY, priceChange: true }, { userId: as.owner.id, deviceId: 'dev-1', permissions: as.owner.permissions });
    await expect(updateProduct(m, tea, input(32_000))).rejects.toMatchObject({ code: 'approval_required', action: 'priceChange' });
    await updateProduct(m, tea, { ...input(31_000), name: 'شاي ليبتون' }); // no price change → no approval
    await updateProduct(m, tea, input(32_000), { approvedBy: (await approveWithPin(db, ids.manager2, '7193', 'priceChange')).approval });
    expect((await getProduct(db, tea))!.product.retailPriceMinor).toBe(32_000);
    await expect(bulkChangePrices(m, [tea], { bp: 1000, field: 'retail' })).rejects.toMatchObject({ code: 'approval_required' });
    await bulkChangePrices(m, [tea], { bp: 1000, field: 'retail', approvedBy: (await approveWithPin(db, ids.owner, 'Shop2026ok', 'priceChange')).approval });
    expect(await audits('approval.price_change')).toHaveLength(2);
    await deleteProduct(m, tea, { approvedBy: (await approveWithPin(db, ids.owner, 'Shop2026ok', 'productDelete')).approval });
    expect((await audits('approval.product_delete'))[0]).toMatchObject({ userId: ids.owner, entityId: tea });
  });
});
