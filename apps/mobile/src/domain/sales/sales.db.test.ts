import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import fc from 'fast-check';
import { DEFAULT_PLANS, SYSTEM_ROLES, type LicenceState } from '@daftarak/shared';
import { createTestDb } from '../../test/testDb';
import type { Db } from '../../db/types';
import { auditLog, integrityChain, salesDocs, salesLines, payments } from '../../db/schema';
import { setLicenceState } from '../licence/guard';
import type { SessionUser } from '../auth/users';
import { ensureInventorySeed } from '../inventory/seed';
import { listUnits } from '../inventory/catalog';
import { createProduct, getProduct } from '../inventory/products';
import { checkStockLevels } from '../inventory/ledger';
import { postAdjustment } from '../inventory/adjust';
import { createCustomer, ledgerBalance, partyBalance } from '../parties/customers';
import { trialBalance } from '../accounting/journal';
import { verifyChain } from '../integrity/chain';
import { verifyAuditRows } from '../audit/audit';
import { cartLineFor, deleteDraft, getSale, listDrafts, loadDraft, parkSale, postReturn, postSale, previewReturn, returnableLines, saveQuotation, todaySummary, voidSale, SalesError, type SalesCtx, type SaleDraft } from './sales';

const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const [owner, manager, cashier] = SYSTEM_ROLES as [typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0], typeof SYSTEM_ROLES[0]];
const lic = (limits = pro.limits): LicenceState => ({ mode: 'full', reason: 'ok', plan: 'pro', limits, features: pro.features, canWrite: true, showAds: false, trialDaysLeft: null, graceDaysLeft: null });
const user = (role = owner, id = `u-${role.key}`): SessionUser => ({ id, name: role.key, color: '#000', roleId: 'r', roleKey: role.key, roleName: role.nameAr, permissions: role.permissions, maxItemDiscountBp: role.maxItemDiscountBp, maxInvoiceDiscountBp: role.maxInvoiceDiscountBp, biometricEnabled: false });

let db: Db;
let ctx: SalesCtx;
let clock: number;
let tea: string;
let oil: string;
let carton: string;

beforeEach(async () => {
  db = createTestDb();
  clock = Date.UTC(2026, 10, 22, 8, 0, 0);
  await ensureInventorySeed(db, { id: 'dev-1', code: 'A' }, clock);
  setLicenceState(lic());
  ctx = {
    db,
    user: user(),
    device: { id: 'dev-1', code: 'A' },
    timezone: 'Africa/Cairo',
    negativeStock: 'warn',
    features: pro.features,
    now: () => (clock += 1000),
    settings: { pricesIncludeVat: true, vatRegistered: true, vatRateBp: 1400 },
  };
  const us = await listUnits(db);
  const piece = us.find((u) => u.nameAr === 'قطعة')!.id;
  carton = us.find((u) => u.nameAr === 'كرتونة')!.id;
  tea = await createProduct(ctx, { name: 'شاي', baseUnitId: piece, costMinor: 1800, retailPriceMinor: 2280, wholesalePriceMinor: 2000, trackStock: true, trackExpiry: false, barcodes: ['111'], largerUnit: { unitId: carton, factorMilli: 24_000, retailPriceMinor: 50_000, wholesalePriceMinor: null, barcode: '222' }, openingQtyMilli: 100_000 });
  oil = await createProduct(ctx, { name: 'زيت', baseUnitId: piece, costMinor: 6000, retailPriceMinor: 7980, wholesalePriceMinor: 7500, trackStock: true, trackExpiry: false, barcodes: ['333'], openingQtyMilli: 10_000 });
});

async function draft(...items: [productId: string, qty: number, unitRow?: string | null][]): Promise<SaleDraft> {
  const lines = [];
  for (const [pid, qty, unitRow] of items) lines.push(await cartLineFor(db, ctx.settings, pid, unitRow ?? null, 'retail', qty));
  return { lines, priceTier: 'retail' };
}
async function cartonRowId(productId: string) {
  return (await getProduct(db, productId))!.units.find((u) => !u.isBase)!.id;
}

describe('posting a sale', () => {
  it('posts an invoice: numbered, stock out, payments, journal balanced, chain + audit', async () => {
    const d = await draft([tea, 3000], [oil, 1000]);
    const r = await postSale(ctx, d, [{ method: 'cash', amountMinor: 20_000 }]);
    expect(r.number).toBe('INV-A-000001');
    expect(r.totalMinor).toBe(3 * 2280 + 7980);
    expect(r.changeMinor).toBe(20_000 - r.totalMinor);
    const s = (await getSale(db, r.docId))!;
    expect(s.doc).toMatchObject({ status: 'POSTED', type: 'INVOICE', taxMinor: expect.any(Number), chainSeq: expect.any(Number) });
    expect(s.lines.map((l) => l.unitCostMinor)).toEqual([1800, 6000]);
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(97_000);
    expect(s.payments).toHaveLength(1);
    expect(s.payments[0]).toMatchObject({ method: 'cash', amountMinor: r.totalMinor });
    const tb = await trialBalance(db);
    expect([...tb.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(tb.get('CASH')).toBe(r.totalMinor);
    expect(tb.get('COGS')).toBe(3 * 1800 + 6000);
    expect(await verifyChain(db, 'dev-1')).toMatchObject({ ok: true });
    const audit = await db.select().from(auditLog).orderBy(asc(auditLog.seq));
    expect(audit.some((a) => a.action === 'sale.post')).toBe(true);
    expect(verifyAuditRows(audit).ok).toBe(true);
  });

  it('scanning a carton barcode sells 24 pieces at the carton price', async () => {
    const d = await draft([tea, 1000, await cartonRowId(tea)]);
    expect(d.lines[0]).toMatchObject({ unitPriceMinor: 50_000, factorMilli: 24_000, unitName: 'كرتونة' });
    await postSale(ctx, d, [{ method: 'card', amountMinor: 50_000 }]);
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(76_000);
  });

  it('split payment and credit (آجل) to a customer updates the customer balance', async () => {
    const c = await createCustomer(ctx, { name: 'محمود', mobile: '01012345678' });
    const d = { ...(await draft([oil, 2000])), customerId: c, customerName: 'محمود' };
    const r = await postSale(ctx, d, [{ method: 'wallet', amountMinor: 5000, label: 'فودافون كاش' }, { method: 'credit', amountMinor: 10_960 }]);
    expect(r.totalMinor).toBe(15_960);
    expect(await partyBalance(db, 'C', c)).toBe(10_960);
    expect(await ledgerBalance(db, 'C', c)).toBe(10_960);
    const tb = await trialBalance(db);
    expect(tb.get('AR')).toBe(10_960);
    expect(tb.get('WALLET')).toBe(5000);
  });

  it('credit without a customer is refused; nothing is written', async () => {
    await expect(postSale(ctx, await draft([oil, 1000]), [{ method: 'credit', amountMinor: 7980 }])).rejects.toMatchObject({ code: 'credit_requires_customer' });
    expect(await db.select().from(salesDocs)).toHaveLength(0);
    expect((await getProduct(db, oil))!.level.qtyMilli).toBe(10_000);
  });

  it('negative stock policy "block" stops the sale and rolls everything back', async () => {
    await expect(postSale({ ...ctx, negativeStock: 'block' }, await draft([oil, 11_000]), [{ method: 'cash', amountMinor: 100_000 }])).rejects.toMatchObject({ code: 'negative_blocked' });
    expect(await db.select().from(salesDocs)).toHaveLength(0);
    expect(await db.select().from(integrityChain).where(eq(integrityChain.docType, 'SALES_INVOICE'))).toHaveLength(0);
  });

  it('cashier: discount above the cap needs a manager; price change needs permission', async () => {
    const cctx = { ...ctx, user: user(cashier, 'u-cash') };
    const d = await draft([oil, 1000]);
    d.lines[0]!.discount = { type: 'percent', bp: 2000 }; // 20 % > cashier 5 %
    await expect(postSale(cctx, d, [{ method: 'cash', amountMinor: 10_000 }])).rejects.toBeInstanceOf(SalesError);
    const r = await postSale(cctx, d, [{ method: 'cash', amountMinor: 10_000 }], { approvedBy: user(manager, 'u-mgr') });
    expect((await getSale(db, r.docId))!.doc.approvedBy).toBe('u-mgr');
    const audit = await db.select().from(auditLog);
    expect(audit.find((a) => a.action === 'sale.discount_override')?.userId).toBe('u-mgr');
    const d2 = await draft([oil, 1000]);
    d2.lines[0]!.unitPriceMinor = 5000;
    await expect(postSale(cctx, d2, [{ method: 'cash', amountMinor: 10_000 }])).rejects.toMatchObject({ code: 'price_change_not_allowed' });
  });

  it('free-plan monthly invoice limit', async () => {
    setLicenceState(lic({ ...pro.limits, invoices_month: 2 }));
    for (let i = 0; i < 2; i++) await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    await expect(postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }])).rejects.toMatchObject({ reason: 'limit' });
  });

  it('refuses to post when the clock is behind the last posted document', async () => {
    await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    clock -= 3_600_000;
    await expect(postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }])).rejects.toMatchObject({ code: 'clock_behind' });
  });
});

describe('parked sales and quotations', () => {
  it('park, list, resume and delete', async () => {
    const id = await parkSale(ctx, await draft([tea, 2000]));
    expect(await listDrafts(db, 'INVOICE')).toHaveLength(1);
    const back = await loadDraft(db, id);
    expect(back.lines[0]).toMatchObject({ productId: tea, qtyMilli: 2000 });
    await deleteDraft(ctx, id);
    expect(await listDrafts(db, 'INVOICE')).toHaveLength(0);
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(100_000); // parking never touches stock
  });
  it('quotation: numbered, editable, converted when sold', async () => {
    const q = await saveQuotation(ctx, await draft([oil, 5000]));
    expect(q.number).toBe('QUO-A-000001');
    const again = await saveQuotation(ctx, await draft([oil, 6000]), q.id);
    expect(again.number).toBe('QUO-A-000001');
    const d = await loadDraft(db, q.id);
    await postSale(ctx, d, [{ method: 'cash', amountMinor: 6 * 7980 }]);
    expect((await getSale(db, q.id))!.doc.status).toBe('CONVERTED');
  });
});

describe('returns', () => {
  it('partial returns up to the sold quantity; stock and money come back; chain stays intact', async () => {
    const c = await createCustomer(ctx, { name: 'سارة' });
    const inv = await postSale(ctx, { ...(await draft([tea, 4000], [oil, 1000])), customerId: c, customerName: 'سارة' }, [{ method: 'cash', amountMinor: 4 * 2280 + 7980 }]);
    const lines = await returnableLines(db, inv.docId);
    const teaLine = lines.find((l) => l.productId === tea)!;
    expect(await previewReturn(db, inv.docId, [{ lineId: teaLine.lineId, qtyMilli: 1000 }])).toBe(2280);
    const r1 = await postReturn(ctx, inv.docId, [{ lineId: teaLine.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 2280 }], 'مكسور');
    expect(r1.number).toBe('RET-A-000001');
    expect((await getProduct(db, tea))!.level.qtyMilli).toBe(97_000);
    await expect(postReturn(ctx, inv.docId, [{ lineId: teaLine.lineId, qtyMilli: 4000 }], [{ method: 'cash', amountMinor: 9120 }], 'x')).rejects.toMatchObject({ code: 'return_too_much' });
    await expect(postReturn(ctx, inv.docId, [{ lineId: teaLine.lineId, qtyMilli: 1000 }], [{ method: 'cash', amountMinor: 1 }], 'x')).rejects.toMatchObject({ code: 'refund_mismatch' });
    // remaining 3 as store credit to the customer
    await postReturn(ctx, inv.docId, [{ lineId: teaLine.lineId, qtyMilli: 3000 }], [{ method: 'credit', amountMinor: 3 * 2280 }], 'x');
    expect(await partyBalance(db, 'C', c)).toBe(-3 * 2280);
    expect((await returnableLines(db, inv.docId)).find((l) => l.productId === tea)!.remainingQtyMilli).toBe(0);
    const tb = await trialBalance(db);
    expect([...tb.values()].reduce((a, b) => a + b, 0)).toBe(0);
    expect(await verifyChain(db, 'dev-1')).toMatchObject({ ok: true });
    expect(await checkStockLevels(db)).toEqual([]);
  });
});

describe('void', () => {
  it('same-day void reverses stock, money and customer balance; original rows unchanged', async () => {
    const c = await createCustomer(ctx, { name: 'علي' });
    const inv = await postSale(ctx, { ...(await draft([oil, 2000])), customerId: c, customerName: 'علي' }, [{ method: 'credit', amountMinor: 15_960 }]);
    const before = (await getSale(db, inv.docId))!;
    await expect(voidSale({ ...ctx, user: user(cashier, 'u-c') }, inv.docId, 'غلط')).rejects.toThrow('missing permission');
    await voidSale(ctx, inv.docId, 'اتسجلت غلط');
    const after = (await getSale(db, inv.docId))!;
    expect(after.doc).toMatchObject({ status: 'VOIDED', voidReason: 'اتسجلت غلط', totalMinor: before.doc.totalMinor, hash: before.doc.hash });
    expect((await getProduct(db, oil))!.level.qtyMilli).toBe(10_000);
    expect(await partyBalance(db, 'C', c)).toBe(0);
    const tb = await trialBalance(db);
    expect(tb.get('SALES') ?? 0).toBe(0);
    expect(tb.get('AR') ?? 0).toBe(0);
    expect(await verifyChain(db, 'dev-1')).toMatchObject({ ok: true });
    await expect(voidSale(ctx, inv.docId, 'again')).rejects.toMatchObject({ code: 'not_voidable' });
  });
  it('cannot void another day or an invoice with returns', async () => {
    const inv = await postSale(ctx, await draft([oil, 2000]), [{ method: 'cash', amountMinor: 15_960 }]);
    clock += 2 * 86_400_000;
    await expect(voidSale(ctx, inv.docId, 'x')).rejects.toMatchObject({ code: 'not_voidable' });
  });
});

describe('tamper evidence', () => {
  it('posted rows cannot be edited through SQL (triggers)', async () => {
    const inv = await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    const err = async (q: ReturnType<typeof sql>) => {
      try {
        await db.run(q);
        return 'ok';
      } catch (e) {
        return String((e as { cause?: Error }).cause?.message ?? (e as Error).message);
      }
    };
    expect(await err(sql`UPDATE sales_docs SET total_minor = 1 WHERE id = ${inv.docId}`)).toMatch(/immutable/);
    expect(await err(sql`UPDATE sales_lines SET qty_milli = 1`)).toMatch(/immutable/);
    expect(await err(sql`DELETE FROM payments`)).toMatch(/immutable/);
    expect(await err(sql`DELETE FROM integrity_chain`)).toMatch(/append-only/);
    expect(await err(sql`UPDATE journal_lines SET debit_minor = 0`)).toMatch(/append-only/);
    expect(await err(sql`UPDATE sales_docs SET print_count = 1 WHERE id = ${inv.docId}`)).toBe('ok'); // allowed
  });

  it('a rooted-phone edit (triggers dropped) is detected, pointing at the exact invoice', async () => {
    const a = await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    const b = await postSale(ctx, await draft([tea, 2000]), [{ method: 'cash', amountMinor: 4560 }]);
    await postSale(ctx, await draft([tea, 1000]), [{ method: 'cash', amountMinor: 2280 }]);
    expect(await verifyChain(db, 'dev-1')).toMatchObject({ ok: true });
    await db.run(sql`DROP TRIGGER sales_lines_posted_immutable`);
    await db.run(sql`UPDATE sales_lines SET qty_milli = 1000, total_minor = 2280 WHERE doc_id = ${b.docId}`);
    const r = await verifyChain(db, 'dev-1');
    expect(r.ok).toBe(false);
    expect(r.firstBreak).toMatchObject({ docId: b.docId, number: b.number, reason: 'hash_mismatch' });
    expect(a.number).toBe('INV-A-000001');
  });

  it('deleting a whole invoice and its chain entry is detected as a gap', async () => {
    await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    const b = await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    await postSale(ctx, await draft([oil, 1000]), [{ method: 'cash', amountMinor: 7980 }]);
    await db.run(sql`DROP TRIGGER integrity_chain_no_delete`);
    const seq = (await getSale(db, b.docId))!.doc.chainSeq!;
    await db.run(sql`DELETE FROM integrity_chain WHERE chain_seq = ${seq}`);
    expect((await verifyChain(db, 'dev-1')).firstBreak).toMatchObject({ reason: 'gap', seq: seq + 1 });
  });
});

describe('PROPERTY: any mix of sales, returns, voids and adjustments keeps books consistent', () => {
  it('journal balanced, stock cache == ledger, chain intact, customer balance == its ledger', async () => {
    const c = await createCustomer(ctx, { name: 'عميل' });
    const op = fc.record({ kind: fc.constantFrom('cash', 'credit', 'return', 'void', 'adjust'), qty: fc.integer({ min: 1, max: 3 }), p: fc.boolean() });
    await fc.assert(
      fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 12 }), async (ops) => {
        for (const o of ops) {
          const pid = o.p ? tea : oil;
          if (o.kind === 'adjust') {
            await postAdjustment(ctx, { productId: pid, deltaMilli: o.qty * 1000, reason: 'found' });
            continue;
          }
          if (o.kind === 'return' || o.kind === 'void') {
            const last = (await db.select().from(salesDocs).where(eq(salesDocs.status, 'POSTED')).orderBy(sql`posted_at DESC`).limit(1))[0];
            if (!last || last.type !== 'INVOICE') continue;
            if (o.kind === 'void') {
              await voidSale(ctx, last.id, 'test').catch((e) => expect(e).toBeInstanceOf(SalesError));
            } else {
              const rl = (await returnableLines(db, last.id)).find((l) => l.remainingQtyMilli > 0);
              if (!rl) continue;
              const total = await previewReturn(db, last.id, [{ lineId: rl.lineId, qtyMilli: 1000 > rl.remainingQtyMilli ? rl.remainingQtyMilli : 1000 }]);
              await postReturn(ctx, last.id, [{ lineId: rl.lineId, qtyMilli: Math.min(1000, rl.remainingQtyMilli) }], [{ method: last.customerId ? 'credit' : 'cash', amountMinor: total }], 'r');
            }
            continue;
          }
          const d = await draft([pid, o.qty * 1000]);
          const withCustomer = o.kind === 'credit' ? { ...d, customerId: c, customerName: 'عميل' } : d;
          const priced = (await import('./sales')).priceDraft(withCustomer, ctx.settings);
          await postSale(ctx, withCustomer, [{ method: o.kind === 'credit' ? 'credit' : 'cash', amountMinor: priced.totalMinor }]);
        }
        const tb = await trialBalance(db);
        expect([...tb.values()].reduce((a, b) => a + b, 0)).toBe(0);
        expect(await checkStockLevels(db)).toEqual([]);
        expect(await verifyChain(db, 'dev-1')).toMatchObject({ ok: true });
        expect(await partyBalance(db, 'C', c)).toBe(await ledgerBalance(db, 'C', c));
        expect(tb.get('AR') ?? 0).toBe(await ledgerBalance(db, 'C', c));
      }),
      { numRuns: 15 },
    );
    const t = await todaySummary(db, (await getSale(db, (await db.select().from(salesDocs).limit(1))[0]!.id))!.doc.businessDay!);
    expect(t.invoices).toBeGreaterThanOrEqual(0);
    expect((await db.select().from(payments)).length).toBeGreaterThan(0);
    expect((await db.select().from(salesLines)).length).toBeGreaterThan(0);
  });
});
