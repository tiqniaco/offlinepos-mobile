/**
 * Append-only, hash-chained audit log (PLAN.md §7.4).
 * hash = SHA-256(canonical_json(entry) || prev_hash). Must be called inside the same transaction as
 * the change it records, so the change and its audit entry commit together.
 */
import { desc } from 'drizzle-orm';
import { GENESIS_HASH, chainHash, uuidv7 } from '@daftarak/shared';
import type { Db as AppDb } from '../../db/types';
import { auditLog } from '../../db/schema';

export type AuditAction =
  | 'business.create'
  | 'device.register'
  | 'user.create'
  | 'user.update'
  | 'user.disable'
  | 'user.pin_change'
  | 'role.create'
  | 'role.update'
  | 'settings.change'
  | 'licence.mode_change'
  | 'clock.rollback'
  | 'override.manager_pin'
  | 'product.create'
  | 'product.update'
  | 'product.price_change'
  | 'product.delete'
  | 'product.restore'
  | 'product.bulk_category'
  | 'product.import'
  | 'category.change'
  | 'stock.adjust'
  | 'stock.count'
  | 'stock.rebuild'
  | 'customer.create'
  | 'sale.post'
  | 'sale.return'
  | 'sale.void'
  | 'sale.discount_override'
  | 'sale.price_override'
  | 'quotation.save'
  | 'party.create'
  | 'party.update'
  | 'party.delete'
  | 'purchase.post'
  | 'purchase.return'
  | 'purchase.void'
  | 'voucher.post'
  | 'voucher.void'
  | 'expense_category.change'
  | 'shift.open'
  | 'shift.close'
  | 'offer.change';

export interface AuditInput {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  userId?: string | null;
  deviceId: string;
  at?: number;
}

/** The exact object that is hashed. Changing this shape breaks verification of old rows — version it instead. */
export function auditPayload(row: {
  seq: number;
  at: number;
  userId: string | null;
  deviceId: string;
  action: string;
  entity: string;
  entityId: string | null;
  beforeJson: string | null;
  afterJson: string | null;
  reason: string | null;
}) {
  // Explicit field list: extra properties on `row` (e.g. hash, prevHash, id) must never enter the hash.
  return {
    v: 1,
    seq: row.seq,
    at: row.at,
    userId: row.userId,
    deviceId: row.deviceId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    beforeJson: row.beforeJson,
    afterJson: row.afterJson,
    reason: row.reason,
  };
}

type Tx = Pick<AppDb, 'select' | 'insert'>;

export async function appendAudit(tx: Tx, input: AuditInput): Promise<string> {
  const last = await tx.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.seq)).limit(1);
  const prevHash = last[0]?.hash ?? GENESIS_HASH;
  const row = {
    seq: (last[0]?.seq ?? 0) + 1,
    at: input.at ?? Date.now(),
    userId: input.userId ?? null,
    deviceId: input.deviceId,
    action: input.action,
    entity: input.entity,
    entityId: input.entityId ?? null,
    beforeJson: input.before === undefined ? null : JSON.stringify(input.before),
    afterJson: input.after === undefined ? null : JSON.stringify(input.after),
    reason: input.reason ?? null,
  };
  const hash = chainHash(auditPayload(row), prevHash);
  const id = uuidv7(row.at);
  await tx.insert(auditLog).values({ id, ...row, hash, prevHash });
  return hash;
}

export interface ChainCheck {
  ok: boolean;
  count: number;
  head: string;
  firstBreakSeq: number | null;
}

/** Recomputes the whole audit chain. */
export function verifyAuditRows(rows: (Parameters<typeof auditPayload>[0] & { hash: string; prevHash: string })[]): ChainCheck {
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const r of rows) {
    if (r.seq !== expectedSeq || r.prevHash !== prev || chainHash(auditPayload(r), prev) !== r.hash) {
      return { ok: false, count: rows.length, head: prev, firstBreakSeq: r.seq };
    }
    prev = r.hash;
    expectedSeq++;
  }
  return { ok: true, count: rows.length, head: prev, firstBreakSeq: null };
}
