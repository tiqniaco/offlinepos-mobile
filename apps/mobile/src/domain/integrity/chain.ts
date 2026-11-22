/**
 * Per-device hash chain of posted documents (PLAN.md §7.3):
 *   hash = SHA-256(canonical_json(payload) || prev_hash)
 * The payload is rebuilt from the stored rows by the SAME builder at posting and at verification, so any
 * later edit of a document, line or payment (even with triggers bypassed on a rooted phone) breaks the chain.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { chainHash, GENESIS_HASH } from '@daftarak/shared';
import { integrityChain, inventoryDocs, inventoryLines, payments, purchaseDocs, purchaseLines, salesDocs, salesLines, shifts, vouchers } from '../../db/schema';
import type { Db } from '../../db/types';

export type ChainDocType = 'SALES_INVOICE' | 'SALES_RETURN' | 'VOID' | 'INVENTORY' | 'PURCHASE' | 'PURCHASE_RETURN' | 'VOUCHER' | 'SHIFT';

type SalesDoc = typeof salesDocs.$inferSelect;
type SalesLine = typeof salesLines.$inferSelect;
type Payment = typeof payments.$inferSelect;

/** Fields that never change after posting (status/print/void fields are excluded on purpose). */
export function salesPayload(doc: SalesDoc, lines: SalesLine[], pays: Payment[]) {
  return {
    v: 1,
    id: doc.id,
    type: doc.type,
    number: doc.number,
    device: doc.deviceId,
    seq: doc.chainSeq,
    postedAt: doc.postedAt,
    issuedAt: doc.issuedAt,
    businessDay: doc.businessDay,
    cashier: doc.cashierId,
    approvedBy: doc.approvedBy,
    customer: doc.customerId,
    customerName: doc.customerName,
    priceTier: doc.priceTier,
    original: doc.originalDocId,
    pricesIncludeVat: doc.pricesIncludeVat,
    invoiceDiscount: doc.invoiceDiscountJson,
    totals: {
      gross: doc.grossMinor,
      lineDiscount: doc.lineDiscountMinor,
      invoiceDiscount: doc.invoiceDiscountMinor,
      net: doc.netMinor,
      tax: doc.taxMinor,
      rounding: doc.roundingMinor,
      total: doc.totalMinor,
      paid: doc.paidMinor,
      credit: doc.creditMinor,
      change: doc.changeMinor,
      tendered: doc.cashTenderedMinor,
    },
    note: doc.note,
    lines: [...lines]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((l) => ({
        id: l.id,
        no: l.lineNo,
        product: l.productId,
        unit: l.productUnitId,
        name: l.nameSnapshot,
        unitName: l.unitNameSnapshot,
        qty: l.qtyMilli,
        factor: l.factorMilli,
        baseQty: l.baseQtyMilli,
        price: l.unitPriceMinor,
        catalogPrice: l.catalogPriceMinor,
        discount: l.discountJson,
        gross: l.grossMinor,
        lineDiscount: l.lineDiscountMinor,
        invoiceDiscount: l.invoiceDiscountMinor,
        taxRate: l.taxRateBp,
        net: l.netMinor,
        tax: l.taxMinor,
        total: l.totalMinor,
        cost: l.unitCostMinor,
        original: l.originalLineId,
      })),
    payments: [...pays]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((p) => ({ id: p.id, kind: p.kind, dir: p.direction, method: p.method, label: p.label, amount: p.amountMinor, party: p.partyId })),
    // Added in Phase 4; omitted when null so documents posted before shifts keep their hash.
    ...(doc.shiftId ? { shift: doc.shiftId } : {}),
  };
}

export function inventoryPayload(doc: typeof inventoryDocs.$inferSelect, lines: (typeof inventoryLines.$inferSelect)[]) {
  return {
    v: 1,
    id: doc.id,
    type: doc.type,
    number: doc.number,
    device: doc.deviceId,
    postedAt: doc.postedAt,
    businessDay: doc.businessDay,
    by: doc.createdBy,
    reason: doc.reason,
    note: doc.note,
    lines: [...lines]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((l) => ({ id: l.id, product: l.productId, batch: l.batchId, expected: l.expectedMilli, counted: l.countedMilli, delta: l.deltaMilli, cost: l.unitCostMinor })),
  };
}

const byId = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));

export function purchasePayload(doc: typeof purchaseDocs.$inferSelect, lines: (typeof purchaseLines.$inferSelect)[], pays: Payment[]) {
  return {
    v: 1,
    id: doc.id,
    type: doc.type,
    number: doc.number,
    device: doc.deviceId,
    by: doc.createdBy,
    supplier: doc.supplierId,
    supplierName: doc.supplierName,
    supplierRef: doc.supplierRef,
    original: doc.originalDocId,
    issuedAt: doc.issuedAt,
    businessDay: doc.businessDay,
    dueDay: doc.dueDay,
    incl: doc.pricesIncludeVat,
    totals: [doc.grossMinor, doc.discountMinor, doc.netMinor, doc.taxMinor, doc.totalMinor, doc.paidMinor, doc.creditMinor],
    note: doc.note,
    shift: doc.shiftId,
    postedAt: doc.postedAt,
    lines: byId(lines).map((l) => [l.id, l.lineNo, l.productId, l.productUnitId, l.nameSnapshot, l.qtyMilli, l.factorMilli, l.baseQtyMilli, l.unitCostMinor, l.discountMinor, l.taxRateBp, l.netMinor, l.taxMinor, l.totalMinor, l.baseUnitCostMinor, l.originalLineId]),
    pays: byId(pays).map((p) => [p.id, p.kind, p.direction, p.method, p.label, p.amountMinor, p.partyId]),
  };
}

export function voucherPayload(v: typeof vouchers.$inferSelect, pays: Payment[]) {
  return {
    v: 1,
    id: v.id,
    type: v.type,
    number: v.number,
    device: v.deviceId,
    by: v.createdBy,
    party: [v.partyType, v.partyId, v.partyName],
    category: [v.categoryId, v.categoryName],
    method: v.method,
    label: v.label,
    amount: v.amountMinor,
    sign: v.sign,
    note: v.note,
    businessDay: v.businessDay,
    shift: v.shiftId,
    postedAt: v.postedAt,
    pays: byId(pays).map((p) => [p.id, p.kind, p.direction, p.method, p.amountMinor]),
  };
}

export function shiftPayload(s: typeof shifts.$inferSelect) {
  return {
    v: 1,
    id: s.id,
    number: s.number,
    device: s.deviceId,
    user: s.userId,
    openedAt: s.openedAt,
    float: s.openingFloatMinor,
    closedAt: s.closedAt,
    closedBy: s.closedBy,
    expected: s.expectedCashMinor,
    counted: s.countedCashMinor,
    diff: s.differenceMinor,
    summary: s.summaryJson,
    note: s.note,
  };
}

export function voidPayload(v: { docId: string; number: string | null; reason: string; by: string; at: number }) {
  return { v: 1, voidOf: v.docId, number: v.number, reason: v.reason, by: v.by, at: v.at };
}

export async function chainHead(tx: Db, deviceId: string): Promise<{ seq: number; hash: string; postedAt: number }> {
  const last = (await tx.select().from(integrityChain).where(eq(integrityChain.deviceId, deviceId)).orderBy(desc(integrityChain.chainSeq)).limit(1))[0];
  return last ? { seq: last.chainSeq, hash: last.hash, postedAt: last.postedAt } : { seq: 0, hash: GENESIS_HASH, postedAt: 0 };
}

/** Append one entry. `buildPayload(seq)` receives the sequence number so it can be part of the hash. */
export async function appendChain(tx: Db, deviceId: string, docType: ChainDocType, docId: string, postedAt: number, buildPayload: (seq: number) => unknown | Promise<unknown>) {
  const head = await chainHead(tx, deviceId);
  const seq = head.seq + 1;
  const hash = chainHash(await buildPayload(seq), head.hash);
  await tx.insert(integrityChain).values({ deviceId, chainSeq: seq, docType, docId, hash, prevHash: head.hash, postedAt });
  return { seq, hash, prevHash: head.hash };
}

export interface ChainReport {
  ok: boolean;
  count: number;
  head: string;
  firstBreak: { seq: number; docType: string; docId: string; number: string | null; reason: 'hash_mismatch' | 'link' | 'gap' | 'missing_doc' | 'doc_hash' } | null;
}

/** Rebuild one entry's payload from the current database rows. */
async function payloadFor(db: Db, docType: string, docId: string, seq: number): Promise<{ payload: unknown; number: string | null; storedDocHash: string | null } | null> {
  if (docType === 'SALES_INVOICE' || docType === 'SALES_RETURN') {
    const doc = (await db.select().from(salesDocs).where(eq(salesDocs.id, docId)).limit(1))[0];
    if (!doc) return null;
    const lines = await db.select().from(salesLines).where(eq(salesLines.docId, docId));
    const pays = await db.select().from(payments).where(and(eq(payments.docId, docId)));
    return { payload: salesPayload({ ...doc, chainSeq: seq }, lines, pays), number: doc.number, storedDocHash: doc.hash };
  }
  if (docType === 'INVENTORY') {
    const doc = (await db.select().from(inventoryDocs).where(eq(inventoryDocs.id, docId)).limit(1))[0];
    if (!doc) return null;
    const lines = await db.select().from(inventoryLines).where(eq(inventoryLines.docId, docId));
    return { payload: inventoryPayload(doc, lines), number: doc.number, storedDocHash: doc.hash };
  }
  if (docType === 'PURCHASE' || docType === 'PURCHASE_RETURN') {
    const doc = (await db.select().from(purchaseDocs).where(eq(purchaseDocs.id, docId)).limit(1))[0];
    if (!doc) return null;
    const lines = await db.select().from(purchaseLines).where(eq(purchaseLines.docId, docId));
    const pays = await db.select().from(payments).where(eq(payments.docId, docId));
    return { payload: purchasePayload(doc, lines, pays), number: doc.number, storedDocHash: doc.hash };
  }
  if (docType === 'VOUCHER') {
    const v = (await db.select().from(vouchers).where(eq(vouchers.id, docId)).limit(1))[0];
    if (!v) return null;
    const pays = await db.select().from(payments).where(eq(payments.docId, docId));
    return { payload: voucherPayload(v, pays), number: v.number, storedDocHash: v.hash };
  }
  if (docType === 'SHIFT') {
    const sh = (await db.select().from(shifts).where(eq(shifts.id, docId)).limit(1))[0];
    if (!sh) return null;
    return { payload: shiftPayload(sh), number: sh.number, storedDocHash: sh.hash };
  }
  return null; // VOID entries are verified through the stored payload fields below
}

/** A voided document of any kind (sales, purchases, vouchers) with its void fields. */
async function voidedDoc(db: Db, id: string) {
  const s = (await db.select({ id: salesDocs.id, number: salesDocs.number, status: salesDocs.status, voidReason: salesDocs.voidReason, voidedBy: salesDocs.voidedBy, voidedAt: salesDocs.voidedAt }).from(salesDocs).where(eq(salesDocs.id, id)).limit(1))[0];
  if (s) return s;
  const p = (await db.select({ id: purchaseDocs.id, number: purchaseDocs.number, status: purchaseDocs.status, voidReason: purchaseDocs.voidReason, voidedBy: purchaseDocs.voidedBy, voidedAt: purchaseDocs.voidedAt }).from(purchaseDocs).where(eq(purchaseDocs.id, id)).limit(1))[0];
  if (p) return p;
  return (await db.select({ id: vouchers.id, number: vouchers.number, status: vouchers.status, voidReason: vouchers.voidReason, voidedBy: vouchers.voidedBy, voidedAt: vouchers.voidedAt }).from(vouchers).where(eq(vouchers.id, id)).limit(1))[0] ?? null;
}

/** Recompute the whole chain of a device and report the first break (integrity screen + tests). */
export async function verifyChain(db: Db, deviceId: string): Promise<ChainReport> {
  const entries = await db.select().from(integrityChain).where(eq(integrityChain.deviceId, deviceId)).orderBy(asc(integrityChain.chainSeq));
  let prev = GENESIS_HASH;
  let expected = 1;
  for (const e of entries) {
    const brk = (reason: NonNullable<ChainReport['firstBreak']>['reason'], number: string | null = null): ChainReport => ({
      ok: false,
      count: entries.length,
      head: prev,
      firstBreak: { seq: e.chainSeq, docType: e.docType, docId: e.docId, number, reason },
    });
    if (e.chainSeq !== expected) return brk('gap');
    if (e.prevHash !== prev) return brk('link');
    if (e.docType === 'VOID') {
      const doc = await voidedDoc(db, e.docId);
      if (!doc || doc.status !== 'VOIDED' || !doc.voidReason || !doc.voidedBy || !doc.voidedAt) return brk('missing_doc', doc?.number ?? null);
      const h = chainHash(voidPayload({ docId: doc.id, number: doc.number, reason: doc.voidReason, by: doc.voidedBy, at: doc.voidedAt }), prev);
      if (h !== e.hash) return brk('hash_mismatch', doc.number);
    } else {
      const p = await payloadFor(db, e.docType, e.docId, e.chainSeq);
      if (!p) return brk('missing_doc');
      if (chainHash(p.payload, prev) !== e.hash) return brk('hash_mismatch', p.number);
      if (p.storedDocHash !== e.hash) return brk('doc_hash', p.number);
    }
    prev = e.hash;
    expected++;
  }
  return { ok: true, count: entries.length, head: prev, firstBreak: null };
}
