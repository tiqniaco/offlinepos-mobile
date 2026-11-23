/**
 * Sales: post invoice, park/resume, quotations, returns, void (SPEC §5, PLAN.md §7).
 * Posting is ONE transaction: re-price → payments → stock (SALE) → customer ledger → journal →
 * hash chain → POSTED → audit. Printing happens only after commit, so a printer can never lose a sale.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  businessDay,
  discountViolations,
  priceCart,
  returnAmounts,
  roleHas,
  settle,
  toBaseQty,
  uuidv7,
  type CapViolation,
  type Discount,
  type PaymentInput,
  type PricedCart,
  applyOffers,
  allocate,
  divRound,
  mulDivRound,
  splitInclusive,
  taxExclusive,
  type OfferDef,
  type OffersResult,
} from '@daftarak/shared';
import { loadOffers, toDef } from '../offers/offers';
import { products, productUnits, salesDocs, salesLines, payments, units, journalEntries, journalLines, accounts, customers, offers as offersTable } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission, type SessionUser } from '../auth/users';
import { assertCanWrite, getLicenceState, LicenceError } from '../licence/guard';
import { UNLIMITED } from '@daftarak/shared';
import type { InvCtx } from '../inventory/context';
import { defaultWarehouseId, postMovements } from '../inventory/ledger';
import { nextDocNumber } from '../inventory/numbering';
import { appendChain, chainHead, salesPayload, voidPayload } from '../integrity/chain';
import { METHOD_ACCOUNT, postJournal, signedLine, type JournalLineInput } from '../accounting/journal';
import { partyBalance, postPartyLedger } from '../parties/customers';
import { shiftIdFor } from '../shifts/shifts';
import { assertVoidWindow } from '../vouchers/vouchers';
import { rollupDoc } from '../reports/rollup';

export interface SalesSettings {
  pricesIncludeVat: boolean;
  vatRegistered: boolean;
  vatRateBp: number;
  cashRoundingMinor?: number;
  /** Selling needs an open cash shift (setting الورديات). */
  requireShift?: boolean;
}

export interface SalesCtx extends InvCtx {
  settings: SalesSettings;
}

export interface CartLine {
  key: string;
  productId: string;
  productUnitId: string;
  name: string;
  unitName: string;
  qtyMilli: number;
  factorMilli: number;
  unitPriceMinor: number;
  catalogPriceMinor: number;
  taxRateBp: number;
  discount?: Discount | null;
  /** For category-scoped offers. */
  categoryId?: string | null;
}

export interface SaleDraft {
  lines: CartLine[];
  customerId?: string | null;
  customerName?: string | null;
  priceTier: 'retail' | 'wholesale';
  invoiceDiscount?: Discount | null;
  note?: string | null;
  /** Set when the cart came from a quotation (marked CONVERTED on posting). */
  quotationId?: string | null;
  /** Coupon typed at the POS (validated again at posting). */
  couponCode?: string | null;
  /** Parked sale this cart was resumed from: removed in the same transaction that posts the sale. */
  sourceId?: string | null;
}

export type SalesErrorCode =
  | 'empty_cart'
  | 'price_change_not_allowed'
  | 'discount_over_cap'
  | 'clock_behind'
  | 'invoice_limit'
  | 'not_found'
  | 'not_voidable'
  | 'has_returns'
  | 'return_too_much'
  | 'refund_mismatch'
  | 'credit_refund_without_customer'
  | 'coupon_invalid'
  | 'credit_limit';

export class SalesError extends Error {
  constructor(
    public readonly code: SalesErrorCode,
    public readonly detail?: { violations?: CapViolation[]; [k: string]: unknown },
  ) {
    super(code);
    this.name = 'SalesError';
  }
}

const now = (ctx: SalesCtx) => (ctx.now ? ctx.now() : Date.now());

// ─────────────────────────── cart helpers ───────────────────────────

/** A cart line for a product/unit at the customer's price tier, with the right VAT rate. */
export async function cartLineFor(db: Db, s: SalesSettings, productId: string, productUnitId: string | null, tier: 'retail' | 'wholesale', qtyMilli = 1000): Promise<CartLine> {
  const p = (await db.select().from(products).where(eq(products.id, productId)).limit(1))[0];
  if (!p) throw new SalesError('not_found');
  const pus = await db.select().from(productUnits).innerJoin(units, eq(units.id, productUnits.unitId)).where(and(eq(productUnits.productId, productId), isNull(productUnits.deletedAt)));
  const row = pus.find((u) => u.product_units.id === productUnitId) ?? pus.find((u) => u.product_units.isBase)!;
  const pu = row.product_units;
  const own = tier === 'wholesale' ? pu.wholesalePriceMinor : pu.retailPriceMinor;
  const basePrice = tier === 'wholesale' ? p.wholesalePriceMinor || p.retailPriceMinor : p.retailPriceMinor;
  const price = pu.isBase ? basePrice : (own ?? Math.round((basePrice * pu.factorMilli) / 1000));
  const rate = s.vatRegistered ? (p.taxRateBp ?? s.vatRateBp) : 0;
  return {
    key: `${productId}:${pu.id}`,
    productId,
    productUnitId: pu.id,
    name: p.variantLabel ? `${p.name} - ${p.variantLabel}` : p.name,
    unitName: row.units.nameAr,
    qtyMilli,
    factorMilli: pu.factorMilli,
    unitPriceMinor: price,
    catalogPriceMinor: price,
    taxRateBp: rate,
    categoryId: p.categoryId ?? null,
  };
}

export interface OfferCtx {
  offers: OfferDef[];
  day: number;
}

export type PricedDraft = PricedCart & { offers: OffersResult | null };

/** Price a cart: automatic offers (best per line) → manual line discounts → coupon → invoice discount. */
export function priceDraft(draft: SaleDraft, s: SalesSettings, oc?: OfferCtx | null): PricedDraft {
  const res =
    oc && (oc.offers.length || draft.couponCode)
      ? applyOffers(
          draft.lines.map((l) => ({ key: l.key, productId: l.productId, categoryId: l.categoryId ?? null, qtyMilli: l.qtyMilli, factorMilli: l.factorMilli, unitPriceMinor: l.unitPriceMinor, priceOverridden: l.unitPriceMinor !== l.catalogPriceMinor })),
          oc.offers,
          { day: oc.day, couponCode: draft.couponCode },
        )
      : null;
  const cart = priceCart({
    lines: draft.lines.map((l) => ({
      key: l.key,
      qtyMilli: l.qtyMilli,
      unitPriceMinor: l.unitPriceMinor,
      taxRateBp: l.taxRateBp,
      discount: l.discount,
      offerDiscountMinor: res?.lines[l.key]?.discountMinor,
      offerId: res?.lines[l.key]?.offerId,
      couponEligible: res?.coupon ? res.coupon.lineKeys.includes(l.key) : true,
    })),
    pricesIncludeVat: s.pricesIncludeVat,
    invoiceDiscount: draft.invoiceDiscount,
    couponMinor: res?.coupon?.discountMinor,
    cashRoundingMinor: s.cashRoundingMinor,
  });
  return { ...cart, offers: res };
}

/** What needs a manager: price changes without permission, discounts above the role caps. */
export function approvalsNeeded(user: SessionUser, draft: SaleDraft, priced: PricedCart): { priceChanges: string[]; violations: CapViolation[] } {
  const priceChanges = roleHas(user.permissions, 'price.change') ? [] : draft.lines.filter((l) => l.unitPriceMinor !== l.catalogPriceMinor).map((l) => l.key);
  return { priceChanges, violations: discountViolations(priced, user) };
}

async function assertInvoiceLimit(db: Db, day: number) {
  const limit = getLicenceState()?.limits.invoices_month ?? UNLIMITED;
  if (limit === UNLIMITED) return;
  const month = Math.floor(day / 100) * 100;
  const n = (await db.select({ n: sql<number>`count(*)` }).from(salesDocs).where(and(eq(salesDocs.type, 'INVOICE'), inArray(salesDocs.status, ['POSTED', 'VOIDED']), gte(salesDocs.businessDay, month), lte(salesDocs.businessDay, month + 99))))[0]?.n ?? 0;
  if (Number(n) >= limit) throw new LicenceError('limit', 'invoices_month');
}

// ─────────────────────────── post invoice ───────────────────────────

export interface PostResult {
  docId: string;
  number: string;
  totalMinor: number;
  changeMinor: number;
}

export async function postSale(ctx: SalesCtx, draft: SaleDraft, pays: PaymentInput[], opts: { approvedBy?: SessionUser | null } = {}): Promise<PostResult> {
  requirePermission(ctx.user, 'sales.create');
  assertCanWrite();
  if (!draft.lines.length) throw new SalesError('empty_cart');
  const tPrice = now(ctx);
  const priced = priceDraft(draft, ctx.settings, { offers: await loadOffers(ctx.db), day: businessDay(tPrice, ctx.timezone) });
  if (draft.couponCode && priced.offers?.couponError) throw new SalesError('coupon_invalid', { reason: priced.offers.couponError });
  const need = approvalsNeeded(ctx.user, draft, priced);
  const approver = opts.approvedBy ?? null;
  if (need.priceChanges.length && !(approver && roleHas(approver.permissions, 'price.change'))) throw new SalesError('price_change_not_allowed', { keys: need.priceChanges });
  if (need.violations.length && !(approver && discountViolations(priced, approver).length === 0)) throw new SalesError('discount_over_cap', { violations: need.violations });
  const settlement = settle(priced.totalMinor, pays, !!draft.customerId);

  return withTx(ctx.db, async (tx) => {
    const t = now(ctx);
    const head = await chainHead(tx, ctx.device.id);
    if (t < head.postedAt) throw new SalesError('clock_behind');
    const day = businessDay(t, ctx.timezone);
    await assertInvoiceLimit(tx, day);
    // Coupon uses are counted again INSIDE the transaction (the offers were loaded before it began).
    const coupon = priced.offers?.coupon;
    if (coupon) {
      const row = (await tx.select({ maxUses: offersTable.maxUses }).from(offersTable).where(eq(offersTable.id, coupon.offerId)).limit(1))[0];
      if (row?.maxUses != null) {
        const used = Number((await tx.select({ n: sql<number>`count(*)` }).from(salesDocs).where(and(eq(salesDocs.couponOfferId, coupon.offerId), eq(salesDocs.type, 'INVOICE'), eq(salesDocs.status, 'POSTED'))))[0]?.n ?? 0);
        if (used >= row.maxUses) throw new SalesError('coupon_invalid', { reason: 'used_up' });
      }
    }
    // Credit limit (حد الائتمان): new balance may not pass it unless a manager approves.
    let creditOverride = false;
    if (settlement.creditMinor > 0 && draft.customerId) {
      const c = (await tx.select({ limit: customers.creditLimitMinor }).from(customers).where(eq(customers.id, draft.customerId)).limit(1))[0];
      const limit = c?.limit ?? null;
      if (limit != null && limit > 0) {
        const balance = await partyBalance(tx, 'C', draft.customerId);
        if (balance + settlement.creditMinor > limit) {
          if (!(approver && roleHas(approver.permissions, 'doc.void'))) throw new SalesError('credit_limit', { limit, balance, credit: settlement.creditMinor });
          creditOverride = true;
        }
      }
    }
    const shiftId = await shiftIdFor(tx, ctx.device.id, !!ctx.settings.requireShift);
    const number = await nextDocNumber(tx, ctx.device, 'SALES_INVOICE', 'INV');
    const docId = uuidv7(t);
    const base = { createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id };

    // Stock first: valued at moving average; blocked here if the negative-stock policy says so.
    const warehouseId = await defaultWarehouseId(tx);
    const tracked = new Set(
      (await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, draft.lines.map((l) => l.productId)), eq(products.trackStock, true)))).map((r) => r.id),
    );
    const lineIds = draft.lines.map(() => uuidv7(t));
    const costs: (number | null)[] = [];
    let cogs = 0;
    for (const [i, l] of draft.lines.entries()) {
      const baseQty = toBaseQty(l.qtyMilli, l.factorMilli);
      if (!tracked.has(l.productId) || baseQty === 0) {
        costs.push(null);
        continue;
      }
      const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: l.productId, qtyMilli: -baseQty, type: 'SALE', sourceType: 'sales_doc', sourceId: docId, sourceLineId: lineIds[i] }]);
      costs.push(mv!.unitCostMinor);
      cogs += -mv!.valueMinor;
    }

    await tx.insert(salesDocs).values({
      id: docId,
      ...base,
      type: 'INVOICE',
      status: 'DRAFT',
      number,
      customerId: draft.customerId ?? null,
      customerName: draft.customerName ?? null,
      priceTier: draft.priceTier,
      cashierId: ctx.user.id,
      shiftId,
      approvedBy: approver && (need.priceChanges.length || need.violations.length || creditOverride) ? approver.id : null,
      issuedAt: t,
      businessDay: day,
      pricesIncludeVat: ctx.settings.pricesIncludeVat,
      invoiceDiscountJson: draft.invoiceDiscount ? JSON.stringify(draft.invoiceDiscount) : null,
      grossMinor: priced.grossMinor,
      lineDiscountMinor: priced.lineDiscountMinor,
      invoiceDiscountMinor: priced.invoiceDiscountMinor,
      netMinor: priced.netMinor,
      taxMinor: priced.taxMinor,
      roundingMinor: priced.roundingMinor,
      totalMinor: priced.totalMinor,
      offerDiscountMinor: priced.offerDiscountMinor,
      couponCode: priced.offers?.coupon?.code ?? null,
      couponOfferId: priced.offers?.coupon?.offerId ?? null,
      couponDiscountMinor: priced.couponMinor,
      paidMinor: settlement.paidMinor,
      creditMinor: settlement.creditMinor,
      changeMinor: settlement.changeMinor,
      cashTenderedMinor: settlement.cashTenderedMinor,
      note: draft.note ?? null,
      postedAt: t,
    });
    for (const [i, l] of draft.lines.entries()) {
      const pl = priced.lines[i]!;
      await tx.insert(salesLines).values({
        id: lineIds[i]!,
        ...base,
        docId,
        lineNo: i + 1,
        productId: l.productId,
        productUnitId: l.productUnitId,
        nameSnapshot: l.name,
        unitNameSnapshot: l.unitName,
        qtyMilli: l.qtyMilli,
        factorMilli: l.factorMilli,
        baseQtyMilli: toBaseQty(l.qtyMilli, l.factorMilli),
        unitPriceMinor: l.unitPriceMinor,
        catalogPriceMinor: l.catalogPriceMinor,
        discountJson: l.discount ? JSON.stringify(l.discount) : null,
        grossMinor: pl.grossMinor,
        lineDiscountMinor: pl.lineDiscountMinor,
        invoiceDiscountMinor: pl.invoiceDiscountMinor,
        taxRateBp: pl.taxRateBp,
        netMinor: pl.netMinor,
        taxMinor: pl.taxMinor,
        totalMinor: pl.totalMinor,
        unitCostMinor: costs[i],
        offerId: pl.offerId,
        offerDiscountMinor: pl.offerDiscountMinor,
        businessDay: day,
      });
    }
    for (const p of settlement.applied) {
      await tx.insert(payments).values({
        id: uuidv7(t),
        ...base,
        kind: 'SALE',
        direction: 'IN',
        method: p.method,
        label: p.label ?? null,
        amountMinor: p.amountMinor,
        partyType: draft.customerId ? 'C' : null,
        partyId: draft.customerId ?? null,
        docType: 'sales_doc',
        docId,
        shiftId,
        businessDay: day,
        postedAt: t,
      });
    }
    if (settlement.creditMinor > 0) {
      await postPartyLedger(tx, ctx, { partyType: 'C', partyId: draft.customerId!, sourceType: 'sales_doc', sourceId: docId, debitMinor: settlement.creditMinor, creditMinor: 0, businessDay: day, at: t });
    }

    const jl: JournalLineInput[] = settlement.applied.map((p) => ({ account: METHOD_ACCOUNT[p.method], debit: p.amountMinor, ...(p.method === 'credit' ? { partyType: 'C' as const, partyId: draft.customerId } : {}) }));
    jl.push({ account: 'SALES', credit: priced.netMinor }, { account: 'VAT_OUT', credit: priced.taxMinor });
    if (priced.roundingMinor > 0) jl.push({ account: 'ROUNDING', credit: priced.roundingMinor });
    if (priced.roundingMinor < 0) jl.push({ account: 'ROUNDING', debit: -priced.roundingMinor });
    if (cogs !== 0) jl.push(signedLine('COGS', cogs), signedLine('INVENTORY', -cogs));
    await postJournal(tx, ctx, { sourceType: 'sales_doc', sourceId: docId, businessDay: day, memo: number, lines: jl, at: t });

    await sealSalesDoc(tx, ctx, docId, 'SALES_INVOICE', t);
    await rollupDoc(tx, docId, 1);
    if (draft.quotationId) await tx.update(salesDocs).set({ status: 'CONVERTED', updatedAt: t }).where(and(eq(salesDocs.id, draft.quotationId), eq(salesDocs.type, 'QUOTATION')));
    if (draft.sourceId) {
      // The held sale became this invoice: drop it atomically, so it is never lost nor sold twice.
      const src = (await tx.select({ type: salesDocs.type, status: salesDocs.status }).from(salesDocs).where(eq(salesDocs.id, draft.sourceId)).limit(1))[0];
      if (src?.type === 'INVOICE' && src.status === 'PARKED') {
        await tx.delete(salesLines).where(eq(salesLines.docId, draft.sourceId));
        await tx.delete(salesDocs).where(eq(salesDocs.id, draft.sourceId));
      }
    }
    await appendAudit(tx, { action: 'sale.post', entity: 'sales_docs', entityId: docId, after: { number, total: priced.totalMinor, lines: draft.lines.length }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    if (creditOverride) {
      await appendAudit(tx, { action: 'override.manager_pin', entity: 'sales_docs', entityId: docId, after: { kind: 'credit_limit', credit: settlement.creditMinor, cashier: ctx.user.id }, userId: approver!.id, deviceId: ctx.device.id, at: t });
    }
    if (approver && (need.priceChanges.length || need.violations.length)) {
      await appendAudit(tx, {
        action: need.violations.length ? 'sale.discount_override' : 'sale.price_override',
        entity: 'sales_docs',
        entityId: docId,
        after: { violations: need.violations, priceChanges: need.priceChanges, cashier: ctx.user.id },
        userId: approver.id,
        deviceId: ctx.device.id,
        at: t,
      });
    }
    return { docId, number, totalMinor: priced.totalMinor, changeMinor: settlement.changeMinor };
  });
}

/** Append the hash-chain entry from the STORED rows and flip the document to POSTED. */
async function sealSalesDoc(tx: Db, ctx: SalesCtx, docId: string, chainType: 'SALES_INVOICE' | 'SALES_RETURN', t: number) {
  const doc = (await tx.select().from(salesDocs).where(eq(salesDocs.id, docId)).limit(1))[0]!;
  const lines = await tx.select().from(salesLines).where(eq(salesLines.docId, docId));
  const pays = await tx.select().from(payments).where(eq(payments.docId, docId));
  const chain = await appendChain(tx, ctx.device.id, chainType, docId, t, (seq) => salesPayload({ ...doc, chainSeq: seq }, lines, pays));
  await tx.update(salesDocs).set({ status: 'POSTED', hash: chain.hash, prevHash: chain.prevHash, chainSeq: chain.seq }).where(eq(salesDocs.id, docId));
}

// ─────────────────────────── park / quotations ───────────────────────────

async function saveDraftDoc(ctx: SalesCtx, draft: SaleDraft, type: 'INVOICE' | 'QUOTATION', status: 'PARKED' | 'DRAFT', existingId?: string | null): Promise<{ id: string; number: string | null }> {
  requirePermission(ctx.user, 'sales.create');
  assertCanWrite();
  if (!draft.lines.length) throw new SalesError('empty_cart');
  // Same pricing the POS shows (offers + coupon), so the held total matches what the customer saw.
  const priced = priceDraft(draft, ctx.settings, { offers: await loadOffers(ctx.db), day: businessDay(now(ctx), ctx.timezone) });
  return withTx(ctx.db, async (tx) => {
    const t = now(ctx);
    const base = { createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id };
    let id = existingId ?? null;
    let number: string | null = null;
    if (id) {
      const old = (await tx.select().from(salesDocs).where(eq(salesDocs.id, id)).limit(1))[0];
      if (old && old.status !== 'DRAFT' && old.status !== 'PARKED') throw new SalesError('not_found');
      if (old) {
        number = old.number;
        await tx.delete(salesLines).where(eq(salesLines.docId, id));
        await tx.delete(salesDocs).where(eq(salesDocs.id, id));
      } else id = uuidv7(t); // the held copy is gone (e.g. deleted from the list): save a fresh one
    } else id = uuidv7(t);
    if (type === 'QUOTATION' && !number) number = await nextDocNumber(tx, ctx.device, 'QUOTATION', 'QUO');
    await tx.insert(salesDocs).values({
      id,
      ...base,
      type,
      status,
      number,
      customerId: draft.customerId ?? null,
      customerName: draft.customerName ?? null,
      priceTier: draft.priceTier,
      cashierId: ctx.user.id,
      issuedAt: t,
      businessDay: businessDay(t, ctx.timezone),
      pricesIncludeVat: ctx.settings.pricesIncludeVat,
      invoiceDiscountJson: draft.invoiceDiscount ? JSON.stringify(draft.invoiceDiscount) : null,
      grossMinor: priced.grossMinor,
      lineDiscountMinor: priced.lineDiscountMinor,
      invoiceDiscountMinor: priced.invoiceDiscountMinor,
      netMinor: priced.netMinor,
      taxMinor: priced.taxMinor,
      roundingMinor: priced.roundingMinor,
      totalMinor: priced.totalMinor,
      offerDiscountMinor: priced.offerDiscountMinor,
      // The typed code is kept even if not (yet) valid; posting validates it again.
      couponCode: draft.couponCode ?? null,
      couponOfferId: priced.offers?.coupon?.offerId ?? null,
      couponDiscountMinor: priced.couponMinor,
      note: draft.note ?? null,
    });
    for (const [i, l] of draft.lines.entries()) {
      const pl = priced.lines[i]!;
      await tx.insert(salesLines).values({
        id: uuidv7(t),
        ...base,
        docId: id,
        lineNo: i + 1,
        productId: l.productId,
        productUnitId: l.productUnitId,
        nameSnapshot: l.name,
        unitNameSnapshot: l.unitName,
        qtyMilli: l.qtyMilli,
        factorMilli: l.factorMilli,
        baseQtyMilli: toBaseQty(l.qtyMilli, l.factorMilli),
        unitPriceMinor: l.unitPriceMinor,
        catalogPriceMinor: l.catalogPriceMinor,
        discountJson: l.discount ? JSON.stringify(l.discount) : null,
        grossMinor: pl.grossMinor,
        lineDiscountMinor: pl.lineDiscountMinor,
        invoiceDiscountMinor: pl.invoiceDiscountMinor,
        taxRateBp: pl.taxRateBp,
        netMinor: pl.netMinor,
        taxMinor: pl.taxMinor,
        totalMinor: pl.totalMinor,
        offerId: pl.offerId,
        offerDiscountMinor: pl.offerDiscountMinor,
      });
    }
    if (type === 'QUOTATION') await appendAudit(tx, { action: 'quotation.save', entity: 'sales_docs', entityId: id, after: { number, total: priced.totalMinor }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return { id, number };
  });
}

/** Hold the current cart (SPEC: park sale). */
export const parkSale = (ctx: SalesCtx, draft: SaleDraft, existingId?: string | null) => saveDraftDoc(ctx, draft, 'INVOICE', 'PARKED', existingId).then((r) => r.id);
/** Save as quotation (عرض سعر) — editable, numbered QUO-A-…, not part of stock or the chain. */
export const saveQuotation = (ctx: SalesCtx, draft: SaleDraft, existingId?: string | null) => saveDraftDoc(ctx, draft, 'QUOTATION', 'DRAFT', existingId);

export async function listDrafts(db: Db, type: 'INVOICE' | 'QUOTATION') {
  return db
    .select({ id: salesDocs.id, number: salesDocs.number, customerName: salesDocs.customerName, totalMinor: salesDocs.totalMinor, createdAt: salesDocs.createdAt, status: salesDocs.status, lines: sql<number>`(SELECT count(*) FROM sales_lines l WHERE l.doc_id = ${salesDocs.id})` })
    .from(salesDocs)
    .where(and(eq(salesDocs.type, type), type === 'INVOICE' ? eq(salesDocs.status, 'PARKED') : or(eq(salesDocs.status, 'DRAFT'), eq(salesDocs.status, 'CONVERTED'))))
    .orderBy(desc(salesDocs.createdAt));
}

/** What changed when a held sale was resumed at today's prices. */
export interface Repriced {
  /** Lines whose catalog price / VAT rate changed since the sale was held. */
  changed: number;
  /** Manual price changes dropped because the current user may not change prices. */
  reverted: number;
}

/**
 * Load a parked sale or quotation back into a cart. With `opts.settings`, a PARKED sale is re-priced from the
 * catalog (current price for its tier and current VAT rate); a manual price on a line is kept only when `opts.user`
 * has price.change, otherwise it goes back to the catalog price (`repriced.reverted`). Quotations keep their prices.
 */
export async function loadDraft(db: Db, id: string, opts: { settings?: SalesSettings; user?: SessionUser | null } = {}): Promise<SaleDraft & { repriced?: Repriced }> {
  const doc = (await db.select().from(salesDocs).where(eq(salesDocs.id, id)).limit(1))[0];
  if (!doc) throw new SalesError('not_found');
  // Category is not stored on the line: take it from the product (category-scoped offers need it).
  const rows = await db
    .select({ l: salesLines, categoryId: products.categoryId })
    .from(salesLines)
    .leftJoin(products, eq(products.id, salesLines.productId))
    .where(eq(salesLines.docId, id))
    .orderBy(asc(salesLines.lineNo));
  let lines: CartLine[] = rows.map(({ l, categoryId }) => ({
    key: `${l.productId}:${l.productUnitId}`,
    productId: l.productId,
    productUnitId: l.productUnitId,
    name: l.nameSnapshot,
    unitName: l.unitNameSnapshot,
    qtyMilli: l.qtyMilli,
    factorMilli: l.factorMilli,
    unitPriceMinor: l.unitPriceMinor,
    catalogPriceMinor: l.catalogPriceMinor,
    taxRateBp: l.taxRateBp,
    discount: l.discountJson ? (JSON.parse(l.discountJson) as Discount) : null,
    categoryId: categoryId ?? null,
  }));
  let repriced: Repriced | undefined;
  if (opts.settings && doc.type === 'INVOICE' && doc.status === 'PARKED') {
    repriced = { changed: 0, reverted: 0 };
    const mayChange = !!opts.user && roleHas(opts.user.permissions, 'price.change');
    const out: CartLine[] = [];
    for (const old of lines) {
      let fresh: CartLine;
      try {
        fresh = await cartLineFor(db, opts.settings, old.productId, old.productUnitId, doc.priceTier, old.qtyMilli);
      } catch {
        out.push(old);
        continue;
      }
      // The unit row was removed since: keep the held line as it was (its quantity is in that unit).
      if (fresh.productUnitId !== old.productUnitId || fresh.factorMilli !== old.factorMilli) {
        out.push(old);
        continue;
      }
      if (fresh.catalogPriceMinor !== old.catalogPriceMinor || fresh.taxRateBp !== old.taxRateBp) repriced.changed++;
      const overridden = old.unitPriceMinor !== old.catalogPriceMinor;
      if (overridden && !mayChange) repriced.reverted++;
      out.push({ ...fresh, discount: old.discount ?? null, unitPriceMinor: overridden && mayChange ? old.unitPriceMinor : fresh.unitPriceMinor });
    }
    lines = out;
  }
  return {
    lines,
    customerId: doc.customerId,
    customerName: doc.customerName,
    priceTier: doc.priceTier,
    invoiceDiscount: doc.invoiceDiscountJson ? (JSON.parse(doc.invoiceDiscountJson) as Discount) : null,
    couponCode: doc.couponCode ?? null,
    note: doc.note,
    quotationId: doc.type === 'QUOTATION' ? doc.id : null,
    sourceId: doc.type === 'INVOICE' && doc.status === 'PARKED' ? doc.id : null,
    ...(repriced ? { repriced } : {}),
  };
}

export async function deleteDraft(ctx: SalesCtx, id: string): Promise<void> {
  requirePermission(ctx.user, 'sales.create');
  await withTx(ctx.db, async (tx) => {
    const doc = (await tx.select().from(salesDocs).where(eq(salesDocs.id, id)).limit(1))[0];
    if (!doc || !['PARKED', 'DRAFT'].includes(doc.status)) throw new SalesError('not_found');
    await tx.delete(salesLines).where(eq(salesLines.docId, id));
    await tx.delete(salesDocs).where(eq(salesDocs.id, id));
  });
}

// ─────────────────────────── queries ───────────────────────────

export async function getSale(db: Db, id: string) {
  const doc = (await db.select().from(salesDocs).where(eq(salesDocs.id, id)).limit(1))[0];
  if (!doc) return null;
  const lines = await db.select().from(salesLines).where(eq(salesLines.docId, id)).orderBy(asc(salesLines.lineNo));
  const pays = await db.select().from(payments).where(eq(payments.docId, id));
  const returns = doc.type === 'INVOICE' ? await db.select({ id: salesDocs.id, number: salesDocs.number, totalMinor: salesDocs.totalMinor, postedAt: salesDocs.postedAt }).from(salesDocs).where(and(eq(salesDocs.originalDocId, id), eq(salesDocs.type, 'RETURN'), eq(salesDocs.status, 'POSTED'))) : [];
  const original = doc.originalDocId ? (await db.select({ id: salesDocs.id, number: salesDocs.number }).from(salesDocs).where(eq(salesDocs.id, doc.originalDocId)).limit(1))[0] ?? null : null;
  return { doc, lines, payments: pays, returns, original };
}

export async function listSales(db: Db, q: { types?: ('INVOICE' | 'RETURN')[]; search?: string; before?: { postedAt: number; id: string } | null; limit?: number } = {}) {
  const conds = [inArray(salesDocs.type, q.types ?? ['INVOICE', 'RETURN']), inArray(salesDocs.status, ['POSTED', 'VOIDED'])];
  if (q.search?.trim()) {
    const s = `%${q.search.trim()}%`;
    conds.push(or(sql`${salesDocs.number} LIKE ${s}`, sql`${salesDocs.customerName} LIKE ${s}`)!);
  }
  if (q.before) conds.push(or(sql`${salesDocs.postedAt} < ${q.before.postedAt}`, and(eq(salesDocs.postedAt, q.before.postedAt), sql`${salesDocs.id} < ${q.before.id}`))!);
  return db
    .select({ id: salesDocs.id, type: salesDocs.type, status: salesDocs.status, number: salesDocs.number, customerName: salesDocs.customerName, totalMinor: salesDocs.totalMinor, creditMinor: salesDocs.creditMinor, postedAt: salesDocs.postedAt })
    .from(salesDocs)
    .where(and(...conds))
    .orderBy(desc(salesDocs.postedAt), desc(salesDocs.id))
    .limit(q.limit ?? 40);
}

/** Today's sales total & count (home). */
export async function todaySummary(db: Db, day: number) {
  const r = (await db
    .select({
      invoices: sql<number>`sum(CASE WHEN type = 'INVOICE' AND status = 'POSTED' THEN 1 ELSE 0 END)`,
      sales: sql<number>`coalesce(sum(CASE WHEN type = 'INVOICE' AND status = 'POSTED' THEN total_minor ELSE 0 END), 0)`,
      returns: sql<number>`coalesce(sum(CASE WHEN type = 'RETURN' AND status = 'POSTED' THEN total_minor ELSE 0 END), 0)`,
    })
    .from(salesDocs)
    .where(eq(salesDocs.businessDay, day)))[0];
  return { invoices: Number(r?.invoices ?? 0), salesMinor: Number(r?.sales ?? 0), returnsMinor: Number(r?.returns ?? 0) };
}

// ─────────────────────────── returns ───────────────────────────

export interface ReturnableLine {
  lineId: string;
  productId: string;
  name: string;
  unitName: string;
  soldQtyMilli: number;
  returnedQtyMilli: number;
  remainingQtyMilli: number;
  unitPriceMinor: number;
  totalMinor: number;
}

export async function returnableLines(db: Db, invoiceId: string): Promise<ReturnableLine[]> {
  const lines = await db.select().from(salesLines).where(eq(salesLines.docId, invoiceId)).orderBy(asc(salesLines.lineNo));
  const back = await db
    .select({ orig: salesLines.originalLineId, qty: sql<number>`sum(${salesLines.qtyMilli})` })
    .from(salesLines)
    .innerJoin(salesDocs, eq(salesDocs.id, salesLines.docId))
    .where(and(eq(salesDocs.originalDocId, invoiceId), eq(salesDocs.type, 'RETURN'), eq(salesDocs.status, 'POSTED')))
    .groupBy(salesLines.originalLineId);
  const returned = new Map(back.map((b) => [b.orig, Number(b.qty)]));
  return lines.map((l) => ({
    lineId: l.id,
    productId: l.productId,
    name: l.nameSnapshot,
    unitName: l.unitNameSnapshot,
    soldQtyMilli: l.qtyMilli,
    returnedQtyMilli: returned.get(l.id) ?? 0,
    remainingQtyMilli: l.qtyMilli - (returned.get(l.id) ?? 0),
    unitPriceMinor: l.unitPriceMinor,
    totalMinor: l.totalMinor,
  }));
}

/** Total refund for the selected items (preview in the return screen), cash rounding included. */
export async function previewReturn(db: Db, invoiceId: string, items: { lineId: string; qtyMilli: number }[], opts: { cashRoundingMinor?: number } = {}): Promise<number> {
  return (await planReturn(db, invoiceId, items, opts)).totalMinor;
}

/** What the customer may still get back in cash/card…: what was paid on the invoice minus earlier non-credit refunds. */
export async function refundablePaid(db: Db, invoiceId: string): Promise<{ paidMinor: number; refundedMinor: number; leftMinor: number; hadCredit: boolean }> {
  const inv = (await db.select({ paid: salesDocs.paidMinor, credit: salesDocs.creditMinor }).from(salesDocs).where(eq(salesDocs.id, invoiceId)).limit(1))[0];
  if (!inv) throw new SalesError('not_found');
  const r = (await db
    .select({ s: sql<number>`coalesce(sum(${payments.amountMinor}), 0)` })
    .from(payments)
    .innerJoin(salesDocs, eq(salesDocs.id, payments.docId))
    .where(and(eq(salesDocs.originalDocId, invoiceId), eq(salesDocs.type, 'RETURN'), eq(salesDocs.status, 'POSTED'), eq(payments.kind, 'REFUND'), sql`${payments.method} <> 'credit'`, eq(payments.voided, false))))[0];
  const refunded = Number(r?.s ?? 0);
  return { paidMinor: inv.paid, refundedMinor: refunded, leftMinor: Math.max(0, inv.paid - refunded), hadCredit: inv.credit > 0 };
}

type SalesLineRow = typeof salesLines.$inferSelect;
interface ReturnPlan {
  lines: { line: SalesLineRow; amounts: { qtyMilli: number; netMinor: number; taxMinor: number; totalMinor: number } }[];
  /** Σ line totals of this return. */
  linesTotalMinor: number;
  /** Cash rounding of this return (the last return reverses what is left of the invoice's rounding). */
  roundingMinor: number;
  totalMinor: number;
}

/**
 * Plan a return: proportional amounts per line (the last return of a line takes the exact remainder), then
 * - offers (BUY_X_GET_Y, quantity prices…): the units the customer KEEPS are re-priced with the same offers; a discount
 *   they no longer qualify for is deducted from the refund (and given back when the rest is returned later);
 * - cash rounding: partial returns are rounded to the same step as the invoice; the return that completes the invoice
 *   reverses what is left of the invoice's rounding, so a full return refunds exactly what was paid.
 */
async function planReturn(db: Db, invoiceId: string, items: { lineId: string; qtyMilli: number }[], opts: { cashRoundingMinor?: number } = {}): Promise<ReturnPlan> {
  const inv = (await db.select().from(salesDocs).where(eq(salesDocs.id, invoiceId)).limit(1))[0];
  if (!inv) throw new SalesError('not_found');
  const orig = await db.select().from(salesLines).where(eq(salesLines.docId, invoiceId));
  const prior = await db
    .select({ orig: salesLines.originalLineId, qty: sql<number>`sum(${salesLines.qtyMilli})`, net: sql<number>`sum(${salesLines.netMinor})`, tax: sql<number>`sum(${salesLines.taxMinor})`, total: sql<number>`sum(${salesLines.totalMinor})` })
    .from(salesLines)
    .innerJoin(salesDocs, eq(salesDocs.id, salesLines.docId))
    .where(and(eq(salesDocs.originalDocId, invoiceId), eq(salesDocs.type, 'RETURN'), eq(salesDocs.status, 'POSTED')))
    .groupBy(salesLines.originalLineId);
  const priorBy = new Map(prior.map((p) => [p.orig, { qtyMilli: Number(p.qty), netMinor: Number(p.net), taxMinor: Number(p.tax), totalMinor: Number(p.total) }]));
  const zero = { qtyMilli: 0, netMinor: 0, taxMinor: 0, totalMinor: 0 };
  const thisQty = new Map<string, number>();
  const lines = items
    .filter((i) => i.qtyMilli > 0)
    .map((i) => {
      const line = orig.find((o) => o.id === i.lineId);
      if (!line) throw new SalesError('not_found');
      const done = priorBy.get(line.id) ?? zero;
      if (i.qtyMilli > line.qtyMilli - done.qtyMilli - (thisQty.get(line.id) ?? 0)) throw new SalesError('return_too_much', { lineId: line.id });
      thisQty.set(line.id, (thisQty.get(line.id) ?? 0) + i.qtyMilli);
      return { line, amounts: returnAmounts({ qtyMilli: line.qtyMilli, netMinor: line.netMinor, taxMinor: line.taxMinor, totalMinor: line.totalMinor }, done, i.qtyMilli) };
    });
  if (!lines.length) return { lines, linesTotalMinor: 0, roundingMinor: 0, totalMinor: 0 };

  const returnedAfter = (l: SalesLineRow) => (priorBy.get(l.id)?.qtyMilli ?? 0) + (thisQty.get(l.id) ?? 0);
  const offerIds = [...new Set(orig.filter((l) => l.offerId && l.offerDiscountMinor > 0).map((l) => l.offerId!))];
  if (offerIds.length) {
    // The offers as they are defined (even if ended since), evaluated on the invoice's day.
    const defs = (await db.select().from(offersTable).where(inArray(offersTable.id, offerIds)))
      .map((r) => toDef(r))
      .filter((o) => o.type !== 'COUPON')
      .map((o) => ({ ...o, active: true, startsDay: null, endsDay: null }));
    const catOf = new Map((await db.select({ id: products.id, cat: products.categoryId }).from(products).where(inArray(products.id, orig.map((l) => l.productId)))).map((r) => [r.id, r.cat]));
    const kept = orig.map((l) => ({ l, qty: l.qtyMilli - returnedAfter(l) })).filter((k) => k.qty > 0);
    const entitled = applyOffers(
      kept.map(({ l, qty }) => ({ key: l.id, productId: l.productId, categoryId: catOf.get(l.productId) ?? null, qtyMilli: qty, factorMilli: l.factorMilli, unitPriceMinor: l.unitPriceMinor, priceOverridden: l.unitPriceMinor !== l.catalogPriceMinor })),
      defs,
      { day: inv.businessDay ?? 0 },
    );
    // Discount the kept units still carry (by proportion) minus what they are entitled to on their own.
    let claw = 0;
    for (const { l, qty } of kept) {
      let d = mulDivRound(l.offerDiscountMinor, qty, l.qtyMilli) - (entitled.lines[l.id]?.discountMinor ?? 0);
      if (!inv.pricesIncludeVat && d !== 0) d += Math.sign(d) * taxExclusive(Math.abs(d), l.taxRateBp);
      claw += d;
    }
    // Cumulative refund the customer is due after this return, minus what earlier returns already refunded.
    let propAfter = 0;
    for (const l of orig) {
      const back = returnedAfter(l);
      propAfter += back >= l.qtyMilli ? l.totalMinor : mulDivRound(l.totalMinor, back, l.qtyMilli);
    }
    claw = Math.min(Math.max(0, claw), Math.max(0, propAfter));
    const refundedBefore = [...priorBy.values()].reduce((s, p) => s + p.totalMinor, 0);
    const due = Math.max(0, propAfter - claw - refundedBefore);
    const base = lines.reduce((s, x) => s + x.amounts.totalMinor, 0);
    if (due !== base) {
      const weights = base > 0 ? lines.map((x) => x.amounts.totalMinor) : lines.map((x) => x.amounts.qtyMilli);
      const shares = allocate(due, weights);
      lines.forEach((x, i) => {
        const total = shares[i]!;
        const tax = x.line.totalMinor > 0 ? mulDivRound(total, x.line.taxMinor, x.line.totalMinor) : splitInclusive(total, x.line.taxRateBp).tax;
        x.amounts = { qtyMilli: x.amounts.qtyMilli, netMinor: total - tax, taxMinor: tax, totalMinor: total };
      });
    }
  }

  const linesTotal = lines.reduce((s, x) => s + x.amounts.totalMinor, 0);
  const completes = orig.every((l) => returnedAfter(l) >= l.qtyMilli);
  let rounding = 0;
  if (completes) {
    const r = (await db
      .select({ s: sql<number>`coalesce(sum(${salesDocs.roundingMinor}), 0)` })
      .from(salesDocs)
      .where(and(eq(salesDocs.originalDocId, invoiceId), eq(salesDocs.type, 'RETURN'), eq(salesDocs.status, 'POSTED'))))[0];
    rounding = inv.roundingMinor - Number(r?.s ?? 0);
  } else if ((opts.cashRoundingMinor ?? 0) > 0) {
    const step = opts.cashRoundingMinor!;
    rounding = divRound(linesTotal, step) * step - linesTotal;
  }
  if (linesTotal + rounding < 0) rounding = -linesTotal;
  return { lines, linesTotalMinor: linesTotal, roundingMinor: rounding, totalMinor: linesTotal + rounding };
}

/**
 * Sales return linked to the original invoice (SPEC §5). Refund methods must add up to the return total exactly;
 * 'credit' reduces the customer's balance (only when the invoice had a customer). Money back (cash, card…) is capped
 * at what the customer actually paid on the invoice (minus earlier refunds): the rest of a credit (آجل) invoice is
 * taken off the customer's balance instead (result.creditMinor says how much).
 */
export async function postReturn(ctx: SalesCtx, invoiceId: string, items: { lineId: string; qtyMilli: number }[], refunds: PaymentInput[], reason: string): Promise<PostResult & { creditMinor: number }> {
  requirePermission(ctx.user, 'sales.return');
  assertCanWrite();
  return withTx(ctx.db, async (tx) => {
    const t = now(ctx);
    const inv = (await tx.select().from(salesDocs).where(eq(salesDocs.id, invoiceId)).limit(1))[0];
    if (!inv || inv.type !== 'INVOICE' || inv.status !== 'POSTED') throw new SalesError('not_found');
    const planned = await planReturn(tx, invoiceId, items, { cashRoundingMinor: ctx.settings.cashRoundingMinor });
    const plan = planned.lines;
    if (!plan.length) throw new SalesError('empty_cart');
    const head = await chainHead(tx, ctx.device.id);
    if (t < head.postedAt) throw new SalesError('clock_behind');
    const total = planned.totalMinor;
    const rounding = planned.roundingMinor;
    const net = plan.reduce((s, p) => s + p.amounts.netMinor, 0);
    const tax = plan.reduce((s, p) => s + p.amounts.taxMinor, 0);
    const refundSum = refunds.reduce((s, r) => s + r.amountMinor, 0);
    if (refundSum !== total || refunds.some((r) => r.amountMinor < 0)) throw new SalesError('refund_mismatch', { total });
    if (refunds.some((r) => r.method === 'credit' && r.amountMinor > 0) && !inv.customerId) throw new SalesError('credit_refund_without_customer');
    // Money back never exceeds what was paid: the excess of a credit invoice comes off the customer's balance.
    let room = (await refundablePaid(tx, invoiceId)).leftMinor;
    let excess = 0;
    const applied: PaymentInput[] = [];
    for (const r of refunds.filter((x) => x.amountMinor > 0)) {
      if (r.method === 'credit') {
        applied.push(r);
        continue;
      }
      const take = Math.min(r.amountMinor, room);
      room -= take;
      excess += r.amountMinor - take;
      if (take > 0) applied.push({ ...r, amountMinor: take });
    }
    if (excess > 0) {
      if (!inv.customerId) throw new SalesError('refund_mismatch', { total, paid: inv.paidMinor });
      const c = applied.find((r) => r.method === 'credit');
      if (c) c.amountMinor += excess;
      else applied.push({ method: 'credit', amountMinor: excess });
    }

    const day = businessDay(t, ctx.timezone);
    const shiftId = await shiftIdFor(tx, ctx.device.id, !!ctx.settings.requireShift && applied.some((r) => r.method === 'cash' && r.amountMinor > 0));
    const number = await nextDocNumber(tx, ctx.device, 'SALES_RETURN', 'RET');
    const docId = uuidv7(t);
    const base = { createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id };
    const warehouseId = await defaultWarehouseId(tx);
    // Only products that track stock NOW get a movement (tracking may have been switched off since the sale).
    const tracked = new Set((await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, plan.map((p) => p.line.productId)), eq(products.trackStock, true)))).map((r) => r.id));
    let cogs = 0;
    const lineIds = plan.map(() => uuidv7(t));
    for (const [i, p] of plan.entries()) {
      const baseQty = toBaseQty(p.amounts.qtyMilli, p.line.factorMilli);
      if (p.line.unitCostMinor == null || baseQty === 0 || !tracked.has(p.line.productId)) continue;
      const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: p.line.productId, qtyMilli: baseQty, type: 'SALE_RETURN', unitCostMinor: p.line.unitCostMinor, sourceType: 'sales_doc', sourceId: docId, sourceLineId: lineIds[i] }]);
      cogs += mv!.valueMinor;
    }
    const credit = applied.filter((r) => r.method === 'credit').reduce((s, r) => s + r.amountMinor, 0);
    await tx.insert(salesDocs).values({
      id: docId,
      ...base,
      type: 'RETURN',
      status: 'DRAFT',
      number,
      customerId: inv.customerId,
      customerName: inv.customerName,
      priceTier: inv.priceTier,
      originalDocId: inv.id,
      cashierId: ctx.user.id,
      shiftId,
      issuedAt: t,
      businessDay: day,
      pricesIncludeVat: inv.pricesIncludeVat,
      grossMinor: planned.linesTotalMinor,
      netMinor: net,
      taxMinor: tax,
      roundingMinor: rounding,
      totalMinor: total,
      paidMinor: total - credit,
      creditMinor: credit,
      note: reason,
      postedAt: t,
    });
    for (const [i, p] of plan.entries()) {
      await tx.insert(salesLines).values({
        id: lineIds[i]!,
        ...base,
        docId,
        lineNo: i + 1,
        productId: p.line.productId,
        productUnitId: p.line.productUnitId,
        nameSnapshot: p.line.nameSnapshot,
        unitNameSnapshot: p.line.unitNameSnapshot,
        qtyMilli: p.amounts.qtyMilli,
        factorMilli: p.line.factorMilli,
        baseQtyMilli: toBaseQty(p.amounts.qtyMilli, p.line.factorMilli),
        unitPriceMinor: p.line.unitPriceMinor,
        catalogPriceMinor: p.line.catalogPriceMinor,
        grossMinor: p.amounts.totalMinor,
        lineDiscountMinor: 0,
        invoiceDiscountMinor: 0,
        taxRateBp: p.line.taxRateBp,
        netMinor: p.amounts.netMinor,
        taxMinor: p.amounts.taxMinor,
        totalMinor: p.amounts.totalMinor,
        // No stock came back (tracking off): no cost either, so profit reports don't count a phantom cost.
        unitCostMinor: tracked.has(p.line.productId) ? p.line.unitCostMinor : null,
        originalLineId: p.line.id,
        businessDay: day,
      });
    }
    for (const r of applied) {
      await tx.insert(payments).values({ id: uuidv7(t), ...base, kind: 'REFUND', direction: 'OUT', method: r.method, label: r.label ?? null, amountMinor: r.amountMinor, partyType: inv.customerId ? 'C' : null, partyId: inv.customerId, docType: 'sales_doc', docId, shiftId, businessDay: day, postedAt: t });
    }
    if (credit > 0) await postPartyLedger(tx, ctx, { partyType: 'C', partyId: inv.customerId!, sourceType: 'sales_doc', sourceId: docId, debitMinor: 0, creditMinor: credit, businessDay: day, at: t });
    const jl: JournalLineInput[] = [{ account: 'SALES_RETURNS', debit: net }, { account: 'VAT_OUT', debit: tax }];
    // Reverse the rounding: the invoice credited ROUNDING with +r, the refund debits it back (signed).
    if (rounding !== 0) jl.push(signedLine('ROUNDING', rounding));
    for (const r of applied) jl.push({ account: METHOD_ACCOUNT[r.method], credit: r.amountMinor, ...(r.method === 'credit' ? { partyType: 'C' as const, partyId: inv.customerId } : {}) });
    if (cogs !== 0) jl.push(signedLine('INVENTORY', cogs), signedLine('COGS', -cogs));
    await postJournal(tx, ctx, { sourceType: 'sales_doc', sourceId: docId, businessDay: day, memo: number, lines: jl, at: t });
    await sealSalesDoc(tx, ctx, docId, 'SALES_RETURN', t);
    await rollupDoc(tx, docId, 1);
    await appendAudit(tx, { action: 'sale.return', entity: 'sales_docs', entityId: docId, after: { number, of: inv.number, total, ...(excess > 0 ? { movedToCredit: excess } : {}) }, reason, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return { docId, number, totalMinor: total, changeMinor: 0, creditMinor: credit };
  });
}

// ─────────────────────────── void ───────────────────────────

/**
 * Void with reason (Manager/Owner, `doc.void`). Allowed while the invoice's cash shift is still open
 * (without shifts: the same business day) and only when the invoice has no posted returns (Q-05).
 * Everything is reversed by new entries; the original rows stay untouched (only status flips).
 */
export async function voidSale(ctx: SalesCtx, docId: string, reason: string): Promise<void> {
  requirePermission(ctx.user, 'doc.void');
  assertCanWrite();
  if (!reason.trim()) throw new SalesError('not_voidable', { why: 'reason_required' });
  await withTx(ctx.db, async (tx) => {
    const t = now(ctx);
    const doc = (await tx.select().from(salesDocs).where(eq(salesDocs.id, docId)).limit(1))[0];
    if (!doc || doc.type !== 'INVOICE' || doc.status !== 'POSTED') throw new SalesError('not_voidable');
    if (t < (await chainHead(tx, ctx.device.id)).postedAt) throw new SalesError('clock_behind');
    const day = businessDay(t, ctx.timezone);
    try {
      await assertVoidWindow(tx, doc.shiftId, doc.businessDay, t, ctx.timezone);
    } catch {
      throw new SalesError('not_voidable', { why: doc.shiftId ? 'shift_closed' : 'other_day' });
    }
    const rets = await tx.select({ id: salesDocs.id }).from(salesDocs).where(and(eq(salesDocs.originalDocId, docId), eq(salesDocs.type, 'RETURN'), eq(salesDocs.status, 'POSTED')));
    if (rets.length) throw new SalesError('has_returns');

    const lines = await tx.select().from(salesLines).where(eq(salesLines.docId, docId));
    const warehouseId = await defaultWarehouseId(tx);
    const tracked = new Set((await tx.select({ id: products.id }).from(products).where(and(inArray(products.id, lines.map((l) => l.productId)), eq(products.trackStock, true)))).map((r) => r.id));
    let back = 0;
    for (const l of lines) {
      if (l.unitCostMinor == null || l.baseQtyMilli === 0 || !tracked.has(l.productId)) continue;
      const [mv] = await postMovements(tx, ctx, warehouseId, [{ productId: l.productId, qtyMilli: l.baseQtyMilli, type: 'VOID_REVERSAL', unitCostMinor: l.unitCostMinor, sourceType: 'sales_void', sourceId: docId, sourceLineId: l.id, reason }]);
      back += mv!.valueMinor;
    }
    if (doc.creditMinor > 0 && doc.customerId) await postPartyLedger(tx, ctx, { partyType: 'C', partyId: doc.customerId, sourceType: 'sales_void', sourceId: docId, debitMinor: 0, creditMinor: doc.creditMinor, businessDay: day, at: t });
    // Mirror the original journal entry.
    const entry = (await tx.select().from(journalEntries).where(and(eq(journalEntries.sourceType, 'sales_doc'), eq(journalEntries.sourceId, docId))).limit(1))[0];
    if (entry) {
      const jl = await tx.select({ key: accounts.systemKey, d: journalLines.debitMinor, c: journalLines.creditMinor, pt: journalLines.partyType, pid: journalLines.partyId }).from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).where(eq(journalLines.entryId, entry.id));
      await postJournal(tx, ctx, {
        sourceType: 'sales_void',
        sourceId: docId,
        businessDay: day,
        memo: `void ${doc.number}`,
        at: t,
        lines: jl.map((x) => ({ account: x.key as never, debit: x.c, credit: x.d, ...(x.pt ? { partyType: x.pt as 'C', partyId: x.pid } : {}) })),
      });
      // The mirror put back the cost the sale took out; the stock value actually changed by `back`
      // (average reset on negative stock, tracking switched off…): post the difference so INVENTORY = Σ stock values.
      const mirrored = jl.filter((x) => x.key === 'INVENTORY').reduce((s, x) => s + x.c - x.d, 0);
      const diff = back - mirrored;
      if (diff !== 0) await postJournal(tx, ctx, { sourceType: 'sales_void', sourceId: docId, businessDay: day, memo: `void ${doc.number} cost`, at: t, lines: [signedLine('INVENTORY', diff), signedLine('COGS', -diff)] });
    }
    await tx.update(payments).set({ voided: true }).where(eq(payments.docId, docId));
    await rollupDoc(tx, docId, -1);
    await tx.update(salesDocs).set({ status: 'VOIDED', voidReason: reason.trim(), voidedBy: ctx.user.id, voidedAt: t }).where(eq(salesDocs.id, docId));
    await appendChain(tx, ctx.device.id, 'VOID', docId, t, () => voidPayload({ docId, number: doc.number, reason: reason.trim(), by: ctx.user.id, at: t }));
    await appendAudit(tx, { action: 'sale.void', entity: 'sales_docs', entityId: docId, before: { status: 'POSTED', total: doc.totalMinor }, after: { status: 'VOIDED' }, reason, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  });
}
