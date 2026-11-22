/**
 * Offers & coupons storage (Phase 5). Evaluation lives in the shared engine (applyOffers); this module
 * loads live offers for a business day and manages the offer list. Needs the plan feature `offers`.
 */
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { HybridLogicalClock, offerProblems, uuidv7, type OfferDef } from '@daftarak/shared';
import { offers, salesDocs } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { requirePermission, type SessionUser } from '../auth/users';
import { assertFeature, hasFeature } from '../licence/guard';

export class OfferError extends Error {
  constructor(public readonly code: 'invalid' | 'code_taken' | 'not_found', public readonly problems: string[] = []) {
    super(code);
    this.name = 'OfferError';
  }
}

type Row = typeof offers.$inferSelect;

export function toDef(r: Row, usedCount = 0): OfferDef {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    active: r.active,
    startsDay: r.startsDay,
    endsDay: r.endsDay,
    priority: r.priority,
    scope: JSON.parse(r.scopeJson),
    valueBp: r.valueBp,
    valueMinor: r.valueMinor,
    minQtyMilli: r.minQtyMilli,
    buyQtyMilli: r.buyQtyMilli,
    getQtyMilli: r.getQtyMilli,
    getProductId: r.getProductId,
    tiers: r.tiersJson ? JSON.parse(r.tiersJson) : null,
    couponCode: r.couponCode,
    minTotalMinor: r.minTotalMinor,
    maxUses: r.maxUses,
    usedCount,
  };
}

/** Offers that may apply today (+ coupon use counts from posted invoices). Empty if the plan lacks offers. */
export async function loadOffers(db: Db): Promise<OfferDef[]> {
  if (!hasFeature('offers')) return [];
  const rows = await db.select().from(offers).where(and(isNull(offers.deletedAt), eq(offers.active, true)));
  if (!rows.length) return [];
  const used = await db
    .select({ id: salesDocs.couponOfferId, n: sql<number>`count(*)` })
    .from(salesDocs)
    .where(and(isNotNull(salesDocs.couponOfferId), eq(salesDocs.type, 'INVOICE'), eq(salesDocs.status, 'POSTED')))
    .groupBy(salesDocs.couponOfferId);
  const usedBy = new Map(used.map((u) => [u.id, Number(u.n)]));
  return rows.map((r) => toDef(r, usedBy.get(r.id) ?? 0));
}

export async function listOffers(db: Db) {
  return db.select().from(offers).where(isNull(offers.deletedAt)).orderBy(desc(offers.active), asc(offers.name));
}

export async function getOffer(db: Db, id: string) {
  return (await db.select().from(offers).where(eq(offers.id, id)).limit(1))[0] ?? null;
}

let hlc: HybridLogicalClock | null = null;

export async function saveOffer(ctx: { db: Db; user: SessionUser; device: { id: string; code: string }; now?: () => number }, def: Omit<OfferDef, 'id' | 'usedCount'> & { id?: string }): Promise<string> {
  requirePermission(ctx.user, 'products.manage');
  assertFeature('offers');
  const problems = offerProblems({ ...def, id: def.id ?? 'new' });
  if (problems.length) throw new OfferError('invalid', problems);
  const t = ctx.now?.() ?? Date.now();
  hlc ??= new HybridLogicalClock(ctx.device.code);
  const code = def.type === 'COUPON' ? def.couponCode!.trim().toUpperCase() : null;
  const values = {
    name: def.name.trim(),
    type: def.type,
    active: def.active,
    startsDay: def.startsDay ?? null,
    endsDay: def.endsDay ?? null,
    priority: def.priority ?? 0,
    scopeJson: JSON.stringify(def.scope),
    valueBp: def.valueBp ?? null,
    valueMinor: def.valueMinor ?? null,
    minQtyMilli: def.minQtyMilli ?? null,
    buyQtyMilli: def.buyQtyMilli ?? null,
    getQtyMilli: def.getQtyMilli ?? null,
    getProductId: def.getProductId ?? null,
    tiersJson: def.tiers?.length ? JSON.stringify(def.tiers) : null,
    couponCode: code,
    minTotalMinor: def.minTotalMinor ?? null,
    maxUses: def.maxUses ?? null,
  };
  return withTx(ctx.db, async (tx) => {
    if (code) {
      const dup = (await tx.select({ id: offers.id }).from(offers).where(and(eq(offers.couponCode, code), isNull(offers.deletedAt))).limit(1))[0];
      if (dup && dup.id !== def.id) throw new OfferError('code_taken');
    }
    let id = def.id;
    if (id) await tx.update(offers).set({ ...values, updatedAt: t, hlc: hlc!.tick() }).where(eq(offers.id, id));
    else {
      id = uuidv7(t);
      await tx.insert(offers).values({ id, ...values, createdAt: t, updatedAt: t, createdBy: ctx.user.id, deviceId: ctx.device.id, hlc: hlc!.tick() });
    }
    await appendAudit(tx, { action: 'offer.change', entity: 'offers', entityId: id, after: values, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
    return id;
  });
}

export async function deleteOffer(ctx: { db: Db; user: SessionUser; device: { id: string; code: string }; now?: () => number }, id: string) {
  requirePermission(ctx.user, 'products.manage');
  const t = ctx.now?.() ?? Date.now();
  await withTx(ctx.db, async (tx) => {
    // Soft delete; the coupon code is freed so it can be reused.
    await tx.update(offers).set({ deletedAt: t, updatedAt: t, active: false, couponCode: null }).where(eq(offers.id, id));
    await appendAudit(tx, { action: 'offer.change', entity: 'offers', entityId: id, after: { deleted: true }, userId: ctx.user.id, deviceId: ctx.device.id, at: t });
  });
}
