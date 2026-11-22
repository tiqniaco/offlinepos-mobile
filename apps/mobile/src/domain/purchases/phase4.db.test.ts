import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { businessDay, DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { accounts, journalLines, shifts, vouchers, purchaseLines } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct, getProduct } from '../inventory/products';
import { checkStockLevels } from '../inventory/ledger';
import { ledgerBalance, partyBalance } from '../parties/customers';
import { trialBalance } from '../accounting/journal';
import { verifyChain } from '../integrity/chain';
import { cartLineFor, postReturn, postSale, voidSale, type SalesCtx } from '../sales/sales';
import { deleteParty, listParties, owed, partyTotals, saveParty, PartyError } from '../parties/parties';
import { customersDue, partyStatement } from '../parties/statement';
import { ensureExpenseCategories, listExpenseCategories, postVoucher, voidVoucher, expenseTotals, VoucherError } from '../vouchers/vouchers';
import { closeShift, currentShift, openShift, shiftSummary, ShiftError } from '../shifts/shifts';
import { postPurchase, postPurchaseReturn, purchaseLineFor, returnablePurchaseLines, voidPurchase, PurchaseError, type PurchaseCtx } from './purchases';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner, , cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic = (): LicenceState => ({ mode: 'full', reason: 'ok', plan: 'pro', limits: pro.limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user = (role = owner, id = `u-${role.key}`): SessionUser => ({ id, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false });
const TZ = 'Africa/Cairo';

let db: Db;
let clock: number;
let ctx: SalesCtx & PurchaseCtx;
let tea: string;
let oil: string;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  await ensureExpenseCategories(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = {
    db,
    user: user(),
    device: { id: 'dev-1', code: 'A' },
    timezone: TZ,
    negativeStock: 'warn',
    features: pro.features,
    now: () => (clock += 1000),
    settings: { pricesIncludeVat: true, vatRegistered: true, vatRateBp: 1400 },
    vatRegistered: true,
    vatRateBp: 1400,
  };
  const us = await listUnits(db);
  const piece = us.find((u) => u.nameAr === 'قطعة')!.id;
  const carton = us.find((u) => u.nameAr === 'كرتونة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1800, retailPriceMinor: 2280, wholesalePriceMinor: 2000, trackStock: true, trackExpiry: false, barcodes: ['111'], largerUnit: { unitId: carton, factorMilli: 24_000, retailPriceMinor: 50_000, wholesalePriceMinor: null, barcode: '222' }, openingQtyMilli: 10_000 });
  oil = await createProduct(ctx, { name: 'زيت', baseUnitId: piece, costMinor: 6000, retailPriceMinor: 7980, wholesalePriceMinor: 7500, trackStock: true, trackExpiry: false, barcodes: ['333'], openingQtyMilli: 10_000 });
});

const nextDay = () => (clock += 86_400_000);
const dbErr = async (q: ReturnType<typeof sql>) => {
  try {
    await db.run(q);
    return 'ok';
  } catch (e) {
    return String((e as { cause?: Error }).cause?.message ?? (e as Error).message);
  }
};
const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

/** AR/AP journal sub-ledger for one party (debit − credit). */
async function journalSub(type: 'C' | 'S', id: string) {
  const r = (await db
    .select({ b: sql<number>`coalesce(sum(${journalLines.debitMinor} - ${journalLines.creditMinor}), 0)` })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(accounts.systemKey, type === 'C' ? 'AR' : 'AP'), eq(journalLines.partyId, id))))[0];
  return Number(r?.b ?? 0);
}

async function expectConsistent(type: 'C' | 'S', id: string) {
  const cached = await partyBalance(db, type, id);
  expect(await ledgerBalance(db, type, id)).toBe(cached);
  expect(await journalSub(type, id)).toBe(cached);
}

describe('customers & suppliers', () => {
  it('creates, updates, lists with balances, refuses duplicate mobile and delete with balance', async () => {
    const s = await saveParty(ctx, 'S', { name: 'شركة الأمل', mobile: '01012345678', address: 'القاهرة' });
    await expect(saveParty(ctx, 'S', { name: 'تانية', mobile: '01012345678' })).rejects.toMatchObject({ code: 'mobile_taken' });
    await saveParty(ctx, 'S', { id: s, name: 'شركة الأمل للتوريدات', mobile: '01012345678' });
    const line = await purchaseLineFor(db, ctx, tea, null, 10_000);
    await postPurchase(ctx, { supplierId: s, lines: [line], pricesIncludeVat: false }, [{ method: 'credit', amountMinor: 20_520 }]);
    const list = await listParties(db, 'S', { search: 'الامل' });
    expect(list).toHaveLength(1);
    expect(owed('S', list[0]!.balanceMinor)).toBe(20_520);
    expect((await partyTotals(db, 'S')).owedMinor).toBe(20_520);
    expect((await listParties(db, 'S', { filter: 'owing' })).map((r) => r.id)).toEqual([s]);
    await expect(deleteParty(ctx, 'S', s)).rejects.toBeInstanceOf(PartyError);
  });

  it('cashier cannot manage suppliers; can add customers', async () => {
    const c = { ...ctx, user: user(cashier) };
    await expect(saveParty(c, 'S', { name: 'x' })).rejects.toThrow();
    expect(await saveParty(c, 'C', { name: 'عميل' })).toBeTruthy();
  });
});

describe('purchases', () => {
  it('unpaid purchase: stock + average cost, supplier owed, VAT input, journal balanced, chain', async () => {
    const s = await saveParty(ctx, 'S', { name: 'مورد' });
    // 2 cartons of tea at 384.00 (ex VAT) = 16.00 per piece; stock had 10 @ 18.00
    const l = { ...(await purchaseLineFor(db, ctx, tea, (await getProduct(db, tea))!.units.find((u) => !u.isBase)!.id, 2000)), unitCostMinor: 38_400 };
    const r = await postPurchase(ctx, { supplierId: s, lines: [l], pricesIncludeVat: false, dueDays: 30 }, [{ method: 'credit', amountMinor: 87_552 }]);
    expect(r.number).toBe('PUR-A-000001');
    expect(r.totalMinor).toBe(76_800 + 10_752);
    const p = (await getProduct(db, tea))!;
    expect(p.level.qtyMilli).toBe(58_000);
    expect(p.level.avgCostMinor).toBe(Math.round((10 * 1800 + 48 * 1600) / 58));
    expect(owed('S', await partyBalance(db, 'S', s))).toBe(87_552);
    await expectConsistent('S', s);
    const tb = await trialBalance(db);
    expect(sum(tb)).toBe(0);
    expect(tb.get('VAT_IN')).toBe(10_752);
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
    expect(await checkStockLevels(db)).toEqual([]);
  });

  it('needs a supplier for credit; cash purchase without supplier is fine', async () => {
    const l = await purchaseLineFor(db, ctx, oil, null, 1000);
    await expect(postPurchase(ctx, { lines: [l], pricesIncludeVat: true }, [{ method: 'credit', amountMinor: 6000 }])).rejects.toMatchObject({ code: 'supplier_required' });
    const r = await postPurchase(ctx, { lines: [l], pricesIncludeVat: true }, [{ method: 'cash', amountMinor: 6000 }]);
    expect(r.totalMinor).toBe(6000);
  });

  it('partial paid + returns (credit and cash) down to exact remainder; void blocked after returns', async () => {
    const s = await saveParty(ctx, 'S', { name: 'مورد' });
    const l = { ...(await purchaseLineFor(db, ctx, oil, null, 3000)), unitCostMinor: 3333 };
    const r = await postPurchase(ctx, { supplierId: s, lines: [l], pricesIncludeVat: true }, [{ method: 'cash', amountMinor: 5000 }, { method: 'credit', amountMinor: 4999 }]);
    expect(owed('S', await partyBalance(db, 'S', s))).toBe(4999);
    const [line] = await returnablePurchaseLines(db, r.docId);
    const r1 = await postPurchaseReturn(ctx, r.docId, [{ lineId: line!.lineId, qtyMilli: 1000 }], [{ method: 'credit', amountMinor: 3333 }], 'تالف');
    expect(owed('S', await partyBalance(db, 'S', s))).toBe(1666);
    await expect(postPurchaseReturn(ctx, r.docId, [{ lineId: line!.lineId, qtyMilli: 3000 }], [{ method: 'cash', amountMinor: 1 }], 'x')).rejects.toMatchObject({ code: 'return_too_much' });
    const r2 = await postPurchaseReturn(ctx, r.docId, [{ lineId: line!.lineId, qtyMilli: 2000 }], [{ method: 'cash', amountMinor: 9999 - 3333 }], 'تالف');
    expect(r1.totalMinor + r2.totalMinor).toBe(9999);
    expect((await returnablePurchaseLines(db, r.docId))[0]!.remainingQtyMilli).toBe(0);
    await expect(voidPurchase(ctx, r.docId, 'غلط')).rejects.toMatchObject({ code: 'has_returns' });
    await expectConsistent('S', s);
    expect(sum(await trialBalance(db))).toBe(0);
    expect(await checkStockLevels(db)).toEqual([]);
  });

  it('void the same day reverses stock, supplier and journal; not the next day', async () => {
    const s = await saveParty(ctx, 'S', { name: 'مورد' });
    const l = await purchaseLineFor(db, ctx, tea, null, 5000);
    const r = await postPurchase(ctx, { supplierId: s, lines: [l], pricesIncludeVat: false }, [{ method: 'credit', amountMinor: 10_260 }]);
    await expect(voidPurchase({ ...ctx, user: user(cashier) }, r.docId, 'x')).rejects.toThrow();
    await voidPurchase(ctx, r.docId, 'إدخال غلط');
    expect(await partyBalance(db, 'S', s)).toBe(0);
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(10_000);
    await expectConsistent('S', s);
    expect(sum(await trialBalance(db))).toBe(0);
    const r2 = await postPurchase(ctx, { supplierId: s, lines: [l], pricesIncludeVat: false }, [{ method: 'credit', amountMinor: 10_260 }]);
    nextDay();
    await expect(voidPurchase(ctx, r2.docId, 'x')).rejects.toMatchObject({ code: 'not_voidable' });
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
  });
});

describe('vouchers', () => {
  it('receipt, refund, supplier payment, expense, opening balances; void mirrors everything', async () => {
    const c = await saveParty(ctx, 'C', { name: 'محمود' });
    const s = await saveParty(ctx, 'S', { name: 'مورد' });
    await postVoucher(ctx, { type: 'OPENING_BALANCE', partyType: 'C', partyId: c, amountMinor: 50_000, method: 'credit' });
    await postVoucher(ctx, { type: 'OPENING_BALANCE', partyType: 'S', partyId: s, amountMinor: 30_000, method: 'credit' });
    expect(owed('C', await partyBalance(db, 'C', c))).toBe(50_000);
    expect(owed('S', await partyBalance(db, 'S', s))).toBe(30_000);
    const rc = await postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 20_000, method: 'cash' });
    expect(rc.number).toBe('RCV-A-000001');
    await postVoucher(ctx, { type: 'PAYMENT', partyId: s, amountMinor: 10_000, method: 'wallet', label: 'فودافون كاش' });
    await postVoucher(ctx, { type: 'CUSTOMER_REFUND', partyId: c, amountMinor: 1000, method: 'cash' });
    const cat = (await listExpenseCategories(db))[0]!;
    const ex = await postVoucher(ctx, { type: 'EXPENSE', categoryId: cat.id, amountMinor: 1500, method: 'cash', note: 'فاتورة' });
    expect(owed('C', await partyBalance(db, 'C', c))).toBe(31_000);
    expect(owed('S', await partyBalance(db, 'S', s))).toBe(20_000);
    await expect(postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 0, method: 'cash' })).rejects.toBeInstanceOf(VoucherError);
    await expect(postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 10, method: 'credit' })).rejects.toMatchObject({ code: 'invalid_method' });
    await expect(postVoucher(ctx, { type: 'EXPENSE', amountMinor: 10, method: 'cash' })).rejects.toMatchObject({ code: 'category_required' });
    await expect(postVoucher({ ...ctx, user: user(cashier) }, { type: 'EXPENSE', categoryId: cat.id, amountMinor: 10, method: 'cash' })).rejects.toThrow();
    const day = businessDay(clock, TZ);
    expect((await expenseTotals(db, day, day))[0]).toMatchObject({ name: cat.name, total: 1500 });
    await voidVoucher(ctx, rc.id, 'مكرر');
    await voidVoucher(ctx, ex.id, 'غلط');
    expect(owed('C', await partyBalance(db, 'C', c))).toBe(51_000);
    await expect(voidVoucher(ctx, rc.id, 'x')).rejects.toMatchObject({ code: 'not_voidable' });
    await expectConsistent('C', c);
    await expectConsistent('S', s);
    const tb = await trialBalance(db);
    expect(sum(tb)).toBe(0);
    expect(tb.get('EXPENSES') ?? 0).toBe(0);
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
  });

  it('vouchers are immutable and cannot be deleted', async () => {
    const c = await saveParty(ctx, 'C', { name: 'x' });
    const v = await postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 100, method: 'cash' });
    expect(await dbErr(sql`UPDATE vouchers SET amount_minor = 1 WHERE id = ${v.id}`)).toMatch(/immutable/);
    expect(await dbErr(sql`DELETE FROM vouchers WHERE id = ${v.id}`)).toMatch(/immutable/);
  });
});

describe('cash shifts', () => {
  it('expected cash == float + Σ cash in − Σ cash out of the shift; difference to over/short', async () => {
    const sctx = { ...ctx, settings: { ...ctx.settings, requireShift: true }, requireShift: true };
    const d = { lines: [await cartLineFor(db, ctx.settings, tea, null, 'retail', 2000)], priceTier: 'retail' as const };
    await expect(postSale(sctx, d, [{ method: 'cash', amountMinor: 4560 }])).rejects.toBeInstanceOf(ShiftError);
    await openShift(sctx, 50_000);
    await expect(openShift(sctx, 1)).rejects.toMatchObject({ code: 'shift_open' });
    const c = await saveParty(ctx, 'C', { name: 'عميل' });
    const sale = await postSale(sctx, d, [{ method: 'cash', amountMinor: 10_000 }]); // change 5440 → cash 4560
    await postSale(sctx, { ...d, customerId: c }, [{ method: 'card', amountMinor: 2000 }, { method: 'credit', amountMinor: 2560 }]);
    await postVoucher(sctx, { type: 'RECEIPT', partyId: c, amountMinor: 2560, method: 'cash' });
    const cat = (await listExpenseCategories(db))[0]!;
    await postVoucher(sctx, { type: 'EXPENSE', categoryId: cat.id, amountMinor: 1000, method: 'cash' });
    const lines = (await import('../sales/sales')).returnableLines;
    const [rl] = await lines(db, sale.docId);
    await postReturn(sctx, sale.docId, [{ lineId: rl!.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2280 }], 'x');
    await postVoucher(sctx, { type: 'CASH_OUT', amountMinor: 3000, method: 'cash', note: 'سحب المالك' });
    const sh = (await currentShift(db, 'dev-1'))!;
    const sm = await shiftSummary(db, sh.id);
    const expected = 50_000 + 4560 + 2560 - 1000 - 2280 - 3000;
    expect(sm.expectedCashMinor).toBe(expected);
    expect(sm.salesCount).toBe(2);
    expect(sm.byMethod).toMatchObject({ cash: 4560 - 2280, card: 2000, credit: 2560 });
    const r = await closeShift(sctx, expected - 500, 'ناقص');
    expect(r.differenceMinor).toBe(-500);
    const tb = await trialBalance(db);
    expect(tb.get('CASH_OVER_SHORT')).toBe(500);
    expect(sum(tb)).toBe(0);
    // Closed shift: no void of its invoices, row immutable, chain intact.
    await expect(voidSale(sctx, sale.docId, 'x')).rejects.toMatchObject({ code: 'not_voidable' });
    expect(await dbErr(sql`UPDATE shifts SET counted_cash_minor = 1 WHERE id = ${sh.id}`)).toMatch(/immutable/);
    expect(await currentShift(db, 'dev-1')).toBeNull();
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
  });

  it('only the shift owner or a manager closes it', async () => {
    await openShift(ctx, 0);
    await expect(closeShift({ ...ctx, user: user(cashier, 'other') }, 0)).rejects.toThrow();
    await closeShift(ctx, 0);
  });
});

describe('account statement', () => {
  it('opening balance, all documents, running balance, closing == ledger; any range', async () => {
    const c = await saveParty(ctx, 'C', { name: 'محمود', mobile: '01011112222' });
    await postVoucher(ctx, { type: 'OPENING_BALANCE', partyType: 'C', partyId: c, amountMinor: 10_000, method: 'credit' });
    const day1 = businessDay(clock, TZ);
    nextDay();
    const d = { lines: [await cartLineFor(db, ctx.settings, oil, null, 'retail', 2000)], priceTier: 'retail' as const, customerId: c, customerName: 'محمود' };
    const inv = await postSale(ctx, d, [{ method: 'cash', amountMinor: 5000 }, { method: 'credit', amountMinor: 10_960 }]);
    await postSale(ctx, d, [{ method: 'cash', amountMinor: 15_960 }]); // fully paid
    const day2 = businessDay(clock, TZ);
    nextDay();
    await postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 8000, method: 'cash' });
    const day3 = businessDay(clock, TZ);

    const all = await partyStatement(db, 'C', c, day1, day3, { detailed: true });
    expect(all.openingMinor).toBe(0);
    expect(all.rows.map((r) => r.kind)).toEqual(['opening', 'invoice', 'invoice', 'receipt']);
    expect(all.rows[1]).toMatchObject({ number: 'INV-A-000001', debitMinor: 15_960, creditMinor: 5000, docTotalMinor: 15_960 });
    expect(all.rows[1]!.items![0]).toMatchObject({ name: 'زيت', qtyMilli: 2000 });
    expect(all.rows[2]!.debitMinor - all.rows[2]!.creditMinor).toBe(0);
    expect(all.closingMinor).toBe(await partyBalance(db, 'C', c));
    expect(all.rows.at(-1)!.balanceMinor).toBe(10_000 + 10_960 - 8000);

    const later = await partyStatement(db, 'C', c, day2, day3);
    expect(later.openingMinor).toBe(10_000);
    expect(later.closingMinor).toBe(all.closingMinor);
    const onlyDay3 = await partyStatement(db, 'C', c, day3, day3);
    expect(onlyDay3.openingMinor).toBe(20_960);
    expect(onlyDay3.rows).toHaveLength(1);
    void inv;

    const due = await customersDue(db, day3);
    expect(due[0]).toMatchObject({ id: c, balanceMinor: 12_960 });
  });

  it('supplier statement shows what we owe', async () => {
    const s = await saveParty(ctx, 'S', { name: 'مورد' });
    const l = await purchaseLineFor(db, ctx, tea, null, 1000);
    await postPurchase(ctx, { supplierId: s, lines: [l], pricesIncludeVat: true }, [{ method: 'credit', amountMinor: 1800 }]);
    await postVoucher(ctx, { type: 'PAYMENT', partyId: s, amountMinor: 800, method: 'cash' });
    const day = businessDay(clock, TZ);
    const st = await partyStatement(db, 'S', s, day, day);
    expect(st.rows.map((r) => [r.kind, r.balanceMinor])).toEqual([['purchase', 1800], ['payment', 1000]]);
    expect(st.closingMinor).toBe(1000);
  });
});

describe('tamper detection (Phase 4 documents)', () => {
  it('catches an edited voucher amount, purchase line and closed shift with triggers removed', async () => {
    const c = await saveParty(ctx, 'C', { name: 'x' });
    const s = await saveParty(ctx, 'S', { name: 'y' });
    const v = await postVoucher(ctx, { type: 'RECEIPT', partyId: c, amountMinor: 1000, method: 'cash' });
    await db.run(sql`DROP TRIGGER vouchers_immutable`);
    await db.run(sql`UPDATE vouchers SET amount_minor = 10 WHERE id = ${v.id}`);
    let rep = await verifyChain(db, 'dev-1');
    expect(rep.firstBreak).toMatchObject({ reason: 'hash_mismatch', number: v.number });
    await db.run(sql`UPDATE vouchers SET amount_minor = 1000 WHERE id = ${v.id}`);
    expect((await verifyChain(db, 'dev-1')).ok).toBe(true);

    const l = await purchaseLineFor(db, ctx, tea, null, 1000);
    const p = await postPurchase(ctx, { supplierId: s, lines: [l], pricesIncludeVat: true }, [{ method: 'credit', amountMinor: 1800 }]);
    await db.run(sql`DROP TRIGGER purchase_lines_posted_immutable`);
    await db.run(sql`UPDATE purchase_lines SET qty_milli = 9000 WHERE doc_id = ${p.docId}`);
    rep = await verifyChain(db, 'dev-1');
    expect(rep.firstBreak).toMatchObject({ reason: 'hash_mismatch', number: p.number });
    await db.update(purchaseLines).set({ qtyMilli: 1000 }).where(eq(purchaseLines.docId, p.docId));

    await openShift(ctx, 100);
    await closeShift(ctx, 100);
    await db.run(sql`DROP TRIGGER shifts_closed_immutable`);
    await db.update(shifts).set({ countedCashMinor: 999_999 });
    rep = await verifyChain(db, 'dev-1');
    expect(rep.firstBreak).toMatchObject({ reason: 'hash_mismatch', docType: 'SHIFT' });
    void vouchers;
  });
});

describe('property: party balance == Σ documents == Σ ledger == AR/AP sub-ledger', () => {
  it('random mix of sales, returns, voids, purchases, purchase returns and vouchers', async () => {
    const op = fc.oneof(
      fc.record({ k: fc.constant('sale' as const), party: fc.nat(2), qty: fc.integer({ min: 1, max: 3 }), credit: fc.boolean() }),
      fc.record({ k: fc.constant('receipt' as const), party: fc.nat(2), amt: fc.integer({ min: 1, max: 9000 }) }),
      fc.record({ k: fc.constant('refund' as const), party: fc.nat(2), amt: fc.integer({ min: 1, max: 500 }) }),
      fc.record({ k: fc.constant('purchase' as const), party: fc.nat(1), qty: fc.integer({ min: 1, max: 4 }), cost: fc.integer({ min: 100, max: 9999 }), paid: fc.nat(100) }),
      fc.record({ k: fc.constant('payment' as const), party: fc.nat(1), amt: fc.integer({ min: 1, max: 9000 }) }),
      fc.record({ k: fc.constant('preturn' as const), which: fc.nat(10), credit: fc.boolean() }),
      fc.record({ k: fc.constant('sreturn' as const), which: fc.nat(10), credit: fc.boolean() }),
      fc.record({ k: fc.constant('void' as const), which: fc.nat(10) }),
      fc.record({ k: fc.constant('opening' as const), party: fc.nat(2), amt: fc.integer({ min: 1, max: 9000 }), neg: fc.boolean() }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 5, maxLength: 25 }), async (ops) => {
        db = createTestDb();
        clock = Date.UTC(2026, 10, 22, 8, 0, 0);
        await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
        ctx = { ...ctx, db };
        const us = await listUnits(db);
        const piece = us.find((u) => u.nameAr === 'قطعة')!.id;
        const prod = await createProduct(ctx, { name: 'منتج', baseUnitId: piece, costMinor: 1000, retailPriceMinor: 1500, wholesalePriceMinor: 0, trackStock: true, trackExpiry: false, barcodes: [], openingQtyMilli: 1_000_000 });
        const cs = [await saveParty(ctx, 'C', { name: 'c0' }), await saveParty(ctx, 'C', { name: 'c1' }), await saveParty(ctx, 'C', { name: 'c2' })];
        const ss = [await saveParty(ctx, 'S', { name: 's0' }), await saveParty(ctx, 'S', { name: 's1' })];
        const sales: string[] = [];
        const purchases: string[] = [];
        for (const o of ops) {
          try {
            if (o.k === 'sale') {
              const line = await cartLineFor(db, ctx.settings, prod, null, 'retail', o.qty * 1000);
              const total = 1500 * o.qty;
              const r = await postSale(ctx, { lines: [line], priceTier: 'retail', customerId: cs[o.party], customerName: 'c' }, o.credit ? [{ method: 'cash', amountMinor: 500 }, { method: 'credit', amountMinor: total - 500 }] : [{ method: 'cash', amountMinor: total }]);
              sales.push(r.docId);
            } else if (o.k === 'receipt') await postVoucher(ctx, { type: 'RECEIPT', partyId: cs[o.party], amountMinor: o.amt, method: 'cash' });
            else if (o.k === 'refund') await postVoucher(ctx, { type: 'CUSTOMER_REFUND', partyId: cs[o.party], amountMinor: o.amt, method: 'cash' });
            else if (o.k === 'opening') await postVoucher(ctx, { type: 'OPENING_BALANCE', partyType: 'C', partyId: cs[o.party], amountMinor: o.amt, method: 'credit', sign: o.neg ? -1 : 1 });
            else if (o.k === 'purchase') {
              const line = { ...(await purchaseLineFor(db, ctx, prod, null, o.qty * 1000)), unitCostMinor: o.cost };
              const total = o.cost * o.qty;
              const paid = Math.floor((total * o.paid) / 100);
              const r = await postPurchase(ctx, { supplierId: ss[o.party], lines: [line], pricesIncludeVat: true }, [...(paid ? [{ method: 'cash' as const, amountMinor: paid }] : []), ...(total - paid ? [{ method: 'credit' as const, amountMinor: total - paid }] : [])]);
              purchases.push(r.docId);
            } else if (o.k === 'payment') await postVoucher(ctx, { type: 'PAYMENT', partyId: ss[o.party], amountMinor: o.amt, method: 'cash' });
            else if (o.k === 'preturn' && purchases.length) {
              const id = purchases[o.which % purchases.length]!;
              const [l] = await returnablePurchaseLines(db, id);
              if (l && l.remainingQtyMilli > 0) {
                const total = await (await import('./purchases')).previewPurchaseReturn(db, id, [{ lineId: l.lineId, qtyMilli: 1000 }]);
                await postPurchaseReturn(ctx, id, [{ lineId: l.lineId, qtyMilli: 1000 }], [{ method: o.credit ? 'credit' : 'cash', amountMinor: total }], 'r');
              }
            } else if (o.k === 'sreturn' && sales.length) {
              const id = sales[o.which % sales.length]!;
              const m = await import('../sales/sales');
              const [l] = await m.returnableLines(db, id);
              if (l && l.remainingQtyMilli > 0) {
                const total = await m.previewReturn(db, id, [{ lineId: l.lineId, qtyMilli: 1000 }]);
                await postReturn(ctx, id, [{ lineId: l.lineId, qtyMilli: 1000 }], [{ method: o.credit ? 'credit' : 'cash', amountMinor: total }], 'r');
              }
            } else if (o.k === 'void') {
              const all = [...sales.map((id) => ['s', id] as const), ...purchases.map((id) => ['p', id] as const)];
              if (all.length) {
                const [t, id] = all[o.which % all.length]!;
                if (t === 's') await voidSale(ctx, id, 'v');
                else await voidPurchase(ctx, id, 'v');
              }
            }
          } catch (e) {
            if (!(e instanceof VoucherError || e instanceof PurchaseError || (e as Error).name === 'SalesError')) throw e;
          }
        }
        for (const id of cs) await expectConsistent('C', id);
        for (const id of ss) await expectConsistent('S', id);
        for (const [type, list] of [['C', cs], ['S', ss]] as const) {
          for (const id of list) {
            const st = await partyStatement(db, type, id, 20000101, 20991231);
            expect(st.closingMinor).toBe(owed(type, await partyBalance(db, type, id)));
          }
        }
        const tb = await trialBalance(db);
        expect(sum(tb)).toBe(0);
        // Σ AR sub-ledgers == AR control account; same for AP.
        let ar = 0;
        for (const id of cs) ar += await partyBalance(db, 'C', id);
        let ap = 0;
        for (const id of ss) ap += await partyBalance(db, 'S', id);
        expect(tb.get('AR') ?? 0).toBe(ar);
        expect(tb.get('AP') ?? 0).toBe(ap);
        expect(await checkStockLevels(db)).toEqual([]);
        expect((await verifyChain(db, 'dev-1')).ok).toBe(true);
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});
