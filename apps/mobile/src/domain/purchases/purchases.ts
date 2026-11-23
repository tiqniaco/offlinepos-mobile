/**
 * Purchases (SPEC §5): purchase invoices (default unpaid → supplier balance), purchase returns linked to the
 * invoice, void. One transaction each: stock (PURCHASE at the invoice cost / PURCHASE_RETURN at average) →
 * supplier ledger → balanced journal → hash chain → POSTED → audit.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { businessDay, pricePurchase, settle, toBaseQty, uuidv7, addDays, mulDivRound, type PaymentInput, type PricedPurchase } from '@daftarak/shared';
import { inventoryDocs, inventoryLines, payments, products, productUnits, purchaseDocs, purchaseLines, stockLevels, units } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission } from '../auth/users';
import { assertCanWrite } from '../licence/guard';
import type { InvCtx } from '../inventory/context';
import { defaultWarehouseId, postMovements } from '../inventory/ledger';
import { nextDocNumber } from '../inventory/numbering';
import { appendChain, chainHead, purchasePayload, voidPayload } from '../integrity/chain';
import { postJournal, signedLine, type AccountKey, type JournalLineInput } from '../accounting/journal';
import { postPartyLedger } from '../parties/customers';
import { getParty } from '../parties/parties';
import { shiftIdFor } from '../shifts/shifts';
import { assertVoidWindow, mirrorJournal } from '../vouchers/vouchers';
import { assertCanCreate, createNewProducts, type NewProductSpec } from '../inventory/quickAdd';

export interface PurchaseCtx extends InvCtx {
  vatRegistered: boolean;
  vatRateBp: number;
  requireShift?: boolean;
}

export interface PurchaseLine {
  key: string;
  productId: string;
  productUnitId: string;
  name: string;
  unitName: string;
  qtyMilli: number;
  factorMilli: number;
  unitCostMinor: number;
  discountMinor?: number;
  taxRateBp: number;
  /**
   * The product does not exist yet (scanned invoice line «صنف جديد»): it is created when the purchase is posted, in
   * the same transaction. productId / productUnitId hold a temporary key until then.
   */
  newProduct?: NewProductSpec;
}

export interface PurchaseDraft {
  supplierId?: string | null;
  supplierRef?: string | null;
  lines: PurchaseLine[];
  pricesIncludeVat: boolean;
  invoiceDiscountMinor?: number;
  dueDays?: number | null;
  note?: string | null;
}

export class PurchaseError extends Error {
  constructor(
    public readonly code: 'empty' | 'supplier_required' | 'not_found' | 'not_voidable' | 'has_returns' | 'return_too_much' | 'refund_mismatch' | 'clock_behind' | 'payment',
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'PurchaseError';
  }
}

const METHOD: Record<string, AccountKey> = { cash: 'CASH', card: 'CARD', wallet: 'WALLET', bank: 'BANK', credit: 'AP' };
const nowOf = (c: { now?: () => number }) => (c.now ? c.now() : Date.now());

/** A purchase line at the last purchase cost of the chosen unit. */
export async function purchaseLineFor(db: Db, ctx: Pick<PurchaseCtx, 'vatRegistered' | 'vatRateBp'>, productId: string, productUnitId: string | null, qtyMilli = 1000): Promise<PurchaseLine> {
  const p = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!p) throw new PurchaseError('not_found');
  const pus = await db.select().from(productUnits).innerJoin(units, eq(units.id, productUnits.unitId)).where(eq(productUnits.productId, productId));
  const row = pus.find((u) => u.product_units.id === productUnitId) ?? pus.find((u) => u.product_units.isBase)!;
  return {
    key: `${productId}:${row.product_units.id}`,
    productId,
    productUnitId: row.product_units.id,
    name: p.variantLabel ? `${p.name} - ${p.variantLabel}` : p.name,
    unitName: row.units.nameAr,
    qtyMilli,
    factorMilli: row.product_units.factorMilli,
    unitCostMinor: mulDivRound(p.costMinor ?? 0, row.product_units.factorMilli, 1000),
    taxRateBp: ctx.vatRegistered ? (p.taxRateBp ?? ctx.vatRateBp) : 0,
  };
}

export function pricePurchaseDraft(d: PurchaseDraft, vatRegistered: boolean): PricedPurchase {
  return pricePurchase({
    lines: d.lines.map((l) => ({ qtyMilli: l.qtyMilli, factorMilli: l.factorMilli, unitCostMinor: l.unitCostMinor, discountMinor: l.discountMinor, taxRateBp: l.taxRateBp })),
    pricesIncludeVat: d.pricesIncludeVat,
    invoiceDiscountMinor: d.invoiceDiscountMinor,
    vatRecoverable: vatRegistered,
  });
}

/** Seal: chain entry from the stored rows, then POSTED (one update). */
async function seal(tx: Db, ctx: PurchaseCtx, docId: string, type: 'PURCHASE' | 'PURCHASE_RETURN', t: number) {
  const doc = (await tx.select().from(purchaseDocs).where(eq(purchaseDocs.id, docId)).limit(1))[0]!;
  const lines = await tx.select().from(purchaseLines).where(eq(purchaseLines.docId, docId));
  const pays = await tx.select().from(payments).where(eq(payments.docId, docId));
  const chain = await appendChain(tx, ctx.device.id, type, docId, t, () => purchasePayload(doc, lines, pays));
  await tx.update(purchaseDocs).set({ status: 'POSTED', hash: chain.hash, prevHash: chain.prevHash, chainSeq: chain.seq }).where(eq(purchaseDocs.id, docId));
}

/**
 * Post a purchase invoice. `pays` lists what was paid now; 'credit' (or any unpaid remainder the UI turns into
 * credit) goes to the supplier's balance and needs a supplier. Default in the UI: all credit (unpaid).
 */
export async function postPurchase(ctx: PurchaseCtx, draft: PurchaseDraft, pays: PaymentInput[]): Promise<{ docId: string; number: string; totalMinor: number }> {
  requirePermission(ctx.user, 'purchases.manage');
  assertCanWrite();
  if (!draft.lines.length) throw new PurchaseError('empty');
  const priced = pricePurchaseDraft(draft, ctx.vatRegistered);
  let st;
  try {
    st = settle(priced.totalMinor, pays, !!draft.supplierId);
  } catch (e) {
    throw new PurchaseError(String((e as Error).message).includes('credit') ? 'supplier_required' : 'payment', { cause: (e as Error).message });
  }
  if (st.changeMinor > 0) throw new PurchaseError('payment', { cause: 'overpaid' });
  const specs = draft.lines.map((l) => l.newProduct).filter((x): x is NewProductSpec => !!x);
  await assertCanCreate(ctx, specs);

  return withTx(ctx.db, async (tx) => {
    const t = nowOf(ctx);
    if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new PurchaseError('clock_behind');
    if (specs.length) {
      // New products from the scanned invoice: created here so a failed posting leaves none behind.
      const made = await createNewProducts(tx, ctx, specs, t, 'purchase_scan');
      let k = 0;
      draft = {
        ...draft,
        lines: draft.lines.map((l) => {
          if (!l.newProduct) return l;
          const c = made[k++]!;
          const { newProduct: _n, ...rest } = l;
          return { ...rest, key: `${c.productId}:${c.baseUnitRowId}`, productId: c.productId, productUnitId: c.baseUnitRowId, unitName: c.unitName, factorMilli: 1000 };
        }),
      };
    }
    const day = businessDay(t, ctx.timezone);
    const supplier = draft.supplierId ? await getParty(tx, 'S', draft.supplierId) : null;
    if (draft.supplierId && !supplier) throw new PurchaseError('supplier_required');
    const cashOut = st.applied.some((p) => p.method === 'cash');
    const shiftId = await shiftIdFor(tx, ctx.device.id, !!ctx.requireShift && cashOut);
    const number = await nextDocNumber(tx, ctx.device, 'PURCHASE', 'PUR');
    const docId = uuidv7(t);
    const base = { createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id };
    const warehouseId = await defaultWarehouseId(tx);
    const tracked = new Set((await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, draft.lines.map((l) => l.productId)), eq(products.trackStock, true)))).map((r) => r.id));
    const lineIds = draft.lines.map(() => uuidv7(t));

    let invValue = 0;
    let expenseValue = 0;
    let variance = 0;
    let trueUp = 0;
    for (const [i, l] of draft.lines.entries()) {
      const pl = priced.lines[i]!;
      const stockValue = ctx.vatRegistered ? pl.netMinor : pl.totalMinor;
      const baseQty = toBaseQty(l.qtyMilli, l.factorMilli);
      if (tracked.has(l.productId) && baseQty > 0) {
        const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: l.productId, qtyMilli: baseQty, type: 'PURCHASE', unitCostMinor: pl.baseUnitCostMinor, sourceType: 'purchase_doc', sourceId: docId, sourceLineId: lineIds[i] }]);
        invValue += mv!.valueMinor;
        // Units sold below zero were costed at the old average; buying resets it, so their cost is trued up (COGS).
        trueUp += mv!.trueUpMinor;
        variance += stockValue - (mv!.valueMinor - mv!.trueUpMinor); // rounding of the per-unit cost
      } else expenseValue += stockValue;
      // Last purchase cost (per base unit) becomes the product's reference cost.
      await tx.update(products).set({ costMinor: pl.baseUnitCostMinor, updatedAt: t }).where(eq(products.id, l.productId));
    }

    await tx.insert(purchaseDocs).values({
      id: docId,
      ...base,
      type: 'PURCHASE',
      status: 'DRAFT',
      number,
      supplierId: draft.supplierId ?? null,
      supplierName: supplier?.name ?? null,
      supplierRef: draft.supplierRef?.trim() || null,
      issuedAt: t,
      businessDay: day,
      dueDay: st.creditMinor > 0 && draft.dueDays ? addDays(day, draft.dueDays) : null,
      pricesIncludeVat: draft.pricesIncludeVat,
      grossMinor: priced.grossMinor,
      discountMinor: priced.discountMinor,
      netMinor: priced.netMinor,
      taxMinor: priced.taxMinor,
      totalMinor: priced.totalMinor,
      paidMinor: st.paidMinor,
      creditMinor: st.creditMinor,
      note: draft.note?.trim() || null,
      shiftId,
      postedAt: t,
    });
    for (const [i, l] of draft.lines.entries()) {
      const pl = priced.lines[i]!;
      await tx.insert(purchaseLines).values({ id: lineIds[i]!, ...base, docId, lineNo: i + 1, productId: l.productId, productUnitId: l.productUnitId, nameSnapshot: l.name, unitNameSnapshot: l.unitName, qtyMilli: l.qtyMilli, factorMilli: l.factorMilli, baseQtyMilli: toBaseQty(l.qtyMilli, l.factorMilli), unitCostMinor: l.unitCostMinor, discountMinor: pl.discountMinor, taxRateBp: l.taxRateBp, netMinor: pl.netMinor, taxMinor: pl.taxMinor, totalMinor: pl.totalMinor, baseUnitCostMinor: pl.baseUnitCostMinor, businessDay: day });
    }
    for (const p of st.applied.filter((x) => x.method !== 'credit')) {
      await tx.insert(payments).values({ id: uuidv7(t), ...base, kind: 'PURCHASE', direction: 'OUT', method: p.method, label: p.label ?? null, amountMinor: p.amountMinor, partyType: draft.supplierId ? 'S' : null, partyId: draft.supplierId ?? null, docType: 'purchase_doc', docId, shiftId, businessDay: day, postedAt: t });
    }
    if (st.creditMinor > 0) await postPartyLedger(tx, ctx, { partyType: 'S', partyId: draft.supplierId!, sourceType: 'purchase_doc', sourceId: docId, debitMinor: 0, creditMinor: st.creditMinor, businessDay: day, at: t, dueDay: draft.dueDays ? addDays(day, draft.dueDays) : null });

    const jl: JournalLineInput[] = [signedLine('INVENTORY', invValue), { account: 'EXPENSES', debit: expenseValue }];
    if (trueUp !== 0) jl.push(signedLine('COGS', -trueUp));
    if (ctx.vatRegistered) jl.push({ account: 'VAT_IN', debit: priced.taxMinor });
    if (variance > 0) jl.push({ account: 'STOCK_ADJ', debit: variance });
    if (variance < 0) jl.push({ account: 'STOCK_ADJ', credit: -variance });
    for (const p of st.applied) jl.push({ account: METHOD[p.method]!, credit: p.amountMinor, ...(p.method === 'credit' ? { partyType: 'S' as const, partyId: draft.supplierId } : {}) });
    await postJournal(tx, ctx, { sourceType: 'purchase_doc', sourceId: docId, businessDay: day, memo: number, lines: jl, at: t });
    await seal(tx, ctx, docId, 'PURCHASE', t);
    await appendAudit(tx, { action: 'purchase.post', entity: 'purchase_docs', entityId: docId, after: { number, total: priced.totalMinor, supplier: draft.supplierId ?? null }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return { docId, number, totalMinor: priced.totalMinor };
  });
}

export interface ReturnablePurchaseLine {
  lineId: string;
  name: string;
  unitName: string;
  boughtQtyMilli: number;
  remainingQtyMilli: number;
  unitCostMinor: number;
}

async function returnedByLine(db: Db, docId: string) {
  const back = await db
    .select({ orig: purchaseLines.originalLineId, qty: sql<number>`sum(${purchaseLines.qtyMilli})`, net: sql<number>`sum(${purchaseLines.netMinor})`, tax: sql<number>`sum(${purchaseLines.taxMinor})`, total: sql<number>`sum(${purchaseLines.totalMinor})` })
    .from(purchaseLines)
    .innerJoin(purchaseDocs, eq(purchaseDocs.id, purchaseLines.docId))
    .where(and(eq(purchaseDocs.originalDocId, docId), eq(purchaseDocs.type, 'PURCHASE_RETURN'), eq(purchaseDocs.status, 'POSTED')))
    .groupBy(purchaseLines.originalLineId);
  return new Map(back.map((b) => [b.orig, { qty: Number(b.qty), net: Number(b.net), tax: Number(b.tax), total: Number(b.total) }]));
}

export async function returnablePurchaseLines(db: Db, docId: string): Promise<ReturnablePurchaseLine[]> {
  const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.docId, docId)).orderBy(asc(purchaseLines.lineNo));
  const done = await returnedByLine(db, docId);
  return lines.map((l) => ({ lineId: l.id, name: l.nameSnapshot, unitName: l.unitNameSnapshot, boughtQtyMilli: l.qtyMilli, remainingQtyMilli: l.qtyMilli - (done.get(l.id)?.qty ?? 0), unitCostMinor: l.unitCostMinor }));
}

async function planPurchaseReturn(db: Db, docId: string, items: { lineId: string; qtyMilli: number }[]) {
  const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.docId, docId));
  const done = await returnedByLine(db, docId);
  return items
    .filter((i) => i.qtyMilli > 0)
    .map((i) => {
      const l = lines.find((x) => x.id === i.lineId);
      if (!l) throw new PurchaseError('not_found');
      const d = done.get(l.id) ?? { qty: 0, net: 0, tax: 0, total: 0 };
      const left = l.qtyMilli - d.qty;
      if (i.qtyMilli > left) throw new PurchaseError('return_too_much', { lineId: l.id });
      // Proportional; the last return of a line takes the exact remainder (no rounding drift).
      const last = i.qtyMilli === left;
      const net = last ? l.netMinor - d.net : mulDivRound(l.netMinor, i.qtyMilli, l.qtyMilli);
      const tax = last ? l.taxMinor - d.tax : mulDivRound(l.taxMinor, i.qtyMilli, l.qtyMilli);
      return { line: l, qtyMilli: i.qtyMilli, net, tax, total: net + tax };
    });
}

export async function previewPurchaseReturn(db: Db, docId: string, items: { lineId: string; qtyMilli: number }[]) {
  return (await planPurchaseReturn(db, docId, items)).reduce((s, p) => s + p.total, 0);
}

/**
 * Return goods to the supplier. `refunds` must add up to the return total: 'credit' lowers what we owe the
 * supplier, other methods = money received back.
 */
export async function postPurchaseReturn(ctx: PurchaseCtx, docId: string, items: { lineId: string; qtyMilli: number }[], refunds: PaymentInput[], reason: string) {
  requirePermission(ctx.user, 'purchases.manage');
  assertCanWrite();
  return withTx(ctx.db, async (tx) => {
    const t = nowOf(ctx);
    const inv = (await tx.select().from(purchaseDocs).where(eq(purchaseDocs.id, docId)).limit(1))[0];
    if (!inv || inv.type !== 'PURCHASE' || inv.status !== 'POSTED') throw new PurchaseError('not_found');
    if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new PurchaseError('clock_behind');
    const plan = await planPurchaseReturn(tx, docId, items);
    if (!plan.length) throw new PurchaseError('empty');
    const total = plan.reduce((s, p) => s + p.total, 0);
    const net = plan.reduce((s, p) => s + p.net, 0);
    const tax = plan.reduce((s, p) => s + p.tax, 0);
    const rs = refunds.filter((r) => r.amountMinor > 0);
    if (rs.reduce((s, r) => s + r.amountMinor, 0) !== total || refunds.some((r) => r.amountMinor < 0)) throw new PurchaseError('refund_mismatch', { total });
    const credit = rs.filter((r) => r.method === 'credit').reduce((s, r) => s + r.amountMinor, 0);
    if (credit > 0 && !inv.supplierId) throw new PurchaseError('supplier_required');
    const day = businessDay(t, ctx.timezone);
    const shiftId = await shiftIdFor(tx, ctx.device.id, false);
    const number = await nextDocNumber(tx, ctx.device, 'PURCHASE_RETURN', 'PRT');
    const id = uuidv7(t);
    const base = { createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id };
    const warehouseId = await defaultWarehouseId(tx);
    const tracked = new Set((await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, plan.map((p) => p.line.productId)), eq(products.trackStock, true)))).map((r) => r.id));
    const lineIds = plan.map(() => uuidv7(t));
    let invOut = 0;
    let expenseBack = 0;
    let variance = 0;
    for (const [i, p] of plan.entries()) {
      const stockValue = ctx.vatRegistered ? p.net : p.total;
      const baseQty = toBaseQty(p.qtyMilli, p.line.factorMilli);
      if (tracked.has(p.line.productId) && baseQty > 0) {
        const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: p.line.productId, qtyMilli: -baseQty, type: 'PURCHASE_RETURN', sourceType: 'purchase_doc', sourceId: id, sourceLineId: lineIds[i] }]);
        invOut += -mv!.valueMinor;
        variance += stockValue - -mv!.valueMinor; // refund above current average = gain
      } else expenseBack += stockValue;
    }
    await tx.insert(purchaseDocs).values({ id, ...base, type: 'PURCHASE_RETURN', status: 'DRAFT', number, supplierId: inv.supplierId, supplierName: inv.supplierName, originalDocId: inv.id, issuedAt: t, businessDay: day, pricesIncludeVat: inv.pricesIncludeVat, grossMinor: total, netMinor: net, taxMinor: tax, totalMinor: total, paidMinor: total - credit, creditMinor: credit, note: reason.trim() || null, shiftId, postedAt: t });
    for (const [i, p] of plan.entries()) {
      await tx.insert(purchaseLines).values({ id: lineIds[i]!, ...base, docId: id, lineNo: i + 1, productId: p.line.productId, productUnitId: p.line.productUnitId, nameSnapshot: p.line.nameSnapshot, unitNameSnapshot: p.line.unitNameSnapshot, qtyMilli: p.qtyMilli, factorMilli: p.line.factorMilli, baseQtyMilli: toBaseQty(p.qtyMilli, p.line.factorMilli), unitCostMinor: p.line.unitCostMinor, discountMinor: 0, taxRateBp: p.line.taxRateBp, netMinor: p.net, taxMinor: p.tax, totalMinor: p.total, baseUnitCostMinor: p.line.baseUnitCostMinor, originalLineId: p.line.id, businessDay: day });
    }
    for (const r of rs.filter((x) => x.method !== 'credit')) {
      await tx.insert(payments).values({ id: uuidv7(t), ...base, kind: 'SUPPLIER_REFUND', direction: 'IN', method: r.method, label: r.label ?? null, amountMinor: r.amountMinor, partyType: inv.supplierId ? 'S' : null, partyId: inv.supplierId, docType: 'purchase_doc', docId: id, shiftId, businessDay: day, postedAt: t });
    }
    if (credit > 0) await postPartyLedger(tx, ctx, { partyType: 'S', partyId: inv.supplierId!, sourceType: 'purchase_doc', sourceId: id, debitMinor: credit, creditMinor: 0, businessDay: day, at: t });
    const jl: JournalLineInput[] = rs.map((r) => ({ account: METHOD[r.method]!, debit: r.amountMinor, ...(r.method === 'credit' ? { partyType: 'S' as const, partyId: inv.supplierId } : {}) }));
    jl.push({ account: 'INVENTORY', credit: invOut }, { account: 'EXPENSES', credit: expenseBack });
    if (ctx.vatRegistered) jl.push({ account: 'VAT_IN', credit: tax });
    if (variance > 0) jl.push({ account: 'STOCK_ADJ', credit: variance });
    if (variance < 0) jl.push({ account: 'STOCK_ADJ', debit: -variance });
    await postJournal(tx, ctx, { sourceType: 'purchase_doc', sourceId: id, businessDay: day, memo: number, lines: jl, at: t });
    await seal(tx, ctx, id, 'PURCHASE_RETURN', t);
    await appendAudit(tx, { action: 'purchase.return', entity: 'purchase_docs', entityId: id, after: { number, of: inv.number, total }, reason, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return { docId: id, number, totalMinor: total };
  });
}

/** Void a purchase invoice (Manager/Owner): same day / open shift, no returns. Stock leaves at the average cost. */
export async function voidPurchase(ctx: PurchaseCtx, docId: string, reason: string): Promise<void> {
  requirePermission(ctx.user, 'doc.void');
  assertCanWrite();
  if (!reason.trim()) throw new PurchaseError('not_voidable', { why: 'reason_required' });
  await withTx(ctx.db, async (tx) => {
    const t = nowOf(ctx);
    const doc = (await tx.select().from(purchaseDocs).where(eq(purchaseDocs.id, docId)).limit(1))[0];
    if (!doc || doc.type !== 'PURCHASE' || doc.status !== 'POSTED') throw new PurchaseError('not_voidable');
    if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new PurchaseError('clock_behind');
    try {
      await assertVoidWindow(tx, doc.shiftId, doc.businessDay, t, ctx.timezone);
    } catch {
      throw new PurchaseError('not_voidable', { why: doc.shiftId ? 'shift_closed' : 'other_day' });
    }
    const rets = await tx.select({ id: purchaseDocs.id }).from(purchaseDocs).where(and(eq(purchaseDocs.originalDocId, docId), eq(purchaseDocs.status, 'POSTED')));
    if (rets.length) throw new PurchaseError('has_returns');
    const day = businessDay(t, ctx.timezone);
    const lines = await tx.select().from(purchaseLines).where(eq(purchaseLines.docId, docId));
    const warehouseId = await defaultWarehouseId(tx);
    const tracked = new Set((await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, lines.map((l) => l.productId)), eq(products.trackStock, true)))).map((r) => r.id));
    let back = 0;
    for (const l of lines) {
      if (!tracked.has(l.productId) || l.baseQtyMilli === 0) continue;
      const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: l.productId, qtyMilli: -l.baseQtyMilli, type: 'VOID_REVERSAL', unitCostMinor: l.baseUnitCostMinor, sourceType: 'purchase_void', sourceId: docId, sourceLineId: l.id, reason }]);
      back += mv!.valueMinor; // what the stock value actually changed by (negative)
    }
    // The product's reference cost goes back to what it was before this invoice (if nothing changed it since).
    for (const l of lines) {
      const p = (await tx.select({ cost: products.costMinor }).from(products).where(eq(products.id, l.productId)).limit(1))[0];
      if (!p || p.cost !== l.baseUnitCostMinor) continue;
      const prev = await previousCost(tx, l.productId, docId, doc.postedAt ?? t, warehouseId);
      if (prev != null && prev !== p.cost) await tx.update(products).set({ costMinor: prev, updatedAt: t }).where(eq(products.id, l.productId));
    }
    // The mirror takes out of INVENTORY what the invoice put in (incl. a negative-stock true-up); the stock value
    // actually changed by `back` (average drift, a reset negative average…): post the difference so INVENTORY = Σ stock values.
    const mirrored = await mirrorJournal(tx, ctx, 'purchase_doc', docId, 'purchase_void', day, t, `void ${doc.number}`);
    const net = (k: AccountKey) => mirrored.filter((x) => x.account === k).reduce((s, x) => s + (x.debit ?? 0) - (x.credit ?? 0), 0);
    const diff = back - net('INVENTORY');
    if (diff !== 0) {
      // Units oversold before this invoice stay at the cost it reset them to, so the true-up the mirror reversed
      // goes back to COGS; any remaining drift is a stock adjustment.
      const reversedTrueUp = -net('COGS'); // the invoice's COGS true-up, debit-positive
      const cogs = Math.sign(reversedTrueUp) === Math.sign(-diff) ? Math.sign(-diff) * Math.min(Math.abs(diff), Math.abs(reversedTrueUp)) : 0;
      const jl: JournalLineInput[] = [signedLine('INVENTORY', diff)];
      if (cogs !== 0) jl.push(signedLine('COGS', cogs));
      if (-diff - cogs !== 0) jl.push(signedLine('STOCK_ADJ', -diff - cogs));
      await postJournal(tx, ctx, { sourceType: 'purchase_void', sourceId: docId, businessDay: day, memo: `void ${doc.number} avg`, at: t, lines: jl });
    }
    if (doc.creditMinor > 0 && doc.supplierId) await postPartyLedger(tx, ctx, { partyType: 'S', partyId: doc.supplierId, sourceType: 'purchase_void', sourceId: docId, debitMinor: doc.creditMinor, creditMinor: 0, businessDay: day, at: t });
    await tx.update(payments).set({ voided: true }).where(eq(payments.docId, docId));
    await tx.update(purchaseDocs).set({ status: 'VOIDED', voidReason: reason.trim(), voidedBy: ctx.user.id, voidedAt: t }).where(eq(purchaseDocs.id, docId));
    await appendChain(tx, ctx.device.id, 'VOID', docId, t, () => voidPayload({ docId, number: doc.number, reason: reason.trim(), by: ctx.user.id, at: t }));
    await appendAudit(tx, { action: 'purchase.void', entity: 'purchase_docs', entityId: docId, before: { status: 'POSTED', total: doc.totalMinor }, after: { status: 'VOIDED' }, reason, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  });
}

/** Cost before `docId`: the last other posted purchase, else the opening stock cost, else the current average. */
async function previousCost(tx: Db, productId: string, docId: string, before: number, warehouseId: string): Promise<number | null> {
  const lp = (await tx
    .select({ c: purchaseLines.baseUnitCostMinor })
    .from(purchaseLines)
    .innerJoin(purchaseDocs, eq(purchaseDocs.id, purchaseLines.docId))
    .where(and(eq(purchaseLines.productId, productId), eq(purchaseDocs.type, 'PURCHASE'), eq(purchaseDocs.status, 'POSTED'), sql`${purchaseDocs.id} <> ${docId}`, lte(purchaseDocs.postedAt, before)))
    .orderBy(desc(purchaseDocs.postedAt), desc(purchaseDocs.id))
    .limit(1))[0];
  if (lp) return lp.c;
  const op = (await tx
    .select({ c: inventoryLines.unitCostMinor })
    .from(inventoryLines)
    .innerJoin(inventoryDocs, eq(inventoryDocs.id, inventoryLines.docId))
    .where(and(eq(inventoryLines.productId, productId), eq(inventoryDocs.type, 'OPENING'), eq(inventoryDocs.status, 'POSTED')))
    .orderBy(desc(inventoryDocs.postedAt))
    .limit(1))[0];
  if (op?.c != null) return op.c;
  const lv = (await tx.select({ a: stockLevels.avgCostMinor, q: stockLevels.qtyMilli }).from(stockLevels).where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId))).limit(1))[0];
  return lv && lv.q > 0 && lv.a > 0 ? lv.a : null;
}

export async function getPurchase(db: Db, id: string) {
  const doc = (await db.select().from(purchaseDocs).where(eq(purchaseDocs.id, id)).limit(1))[0];
  if (!doc) return null;
  const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.docId, id)).orderBy(asc(purchaseLines.lineNo));
  const pays = await db.select().from(payments).where(eq(payments.docId, id));
  const returns = await db.select().from(purchaseDocs).where(and(eq(purchaseDocs.originalDocId, id), eq(purchaseDocs.type, 'PURCHASE_RETURN'))).orderBy(desc(purchaseDocs.postedAt));
  return { doc, lines, pays, returns };
}

export async function listPurchases(db: Db, q: { types?: ('PURCHASE' | 'PURCHASE_RETURN')[]; supplierId?: string; from?: number; to?: number; limit?: number; offset?: number } = {}) {
  const c = [inArray(purchaseDocs.status, ['POSTED', 'VOIDED'] as const)];
  if (q.types?.length) c.push(inArray(purchaseDocs.type, q.types));
  if (q.supplierId) c.push(eq(purchaseDocs.supplierId, q.supplierId));
  if (q.from) c.push(gte(purchaseDocs.businessDay, q.from));
  if (q.to) c.push(lte(purchaseDocs.businessDay, q.to));
  return db.select().from(purchaseDocs).where(and(...c)).orderBy(desc(purchaseDocs.postedAt), desc(purchaseDocs.id)).limit(q.limit ?? 100).offset(q.offset ?? 0);
}
