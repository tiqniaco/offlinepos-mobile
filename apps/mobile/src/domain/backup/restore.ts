/**
 * Backup / restore steps that touch the database (driver-independent, tested in Node):
 * - backupCounts: figures shown in the backup list and the restore preview;
 * - completeRestore: after the snapshot is installed as the live DB on the NEW phone, register the new device
 *   (new code, own doc numbering, own hash chain from genesis), mark the old device inactive, audit "restore".
 * File work (snapshot export, encryption, upload/download) lives in features/backup (device-specific).
 */
import { and, count, eq, sql } from 'drizzle-orm';
import { business, devices, docSequences, integrityChain, products, customers, salesDocs, suppliers, auditLog } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { setMeta } from '../device';
import { ensureInventorySeed } from '../inventory/seed';
import { ensureExpenseCategories } from '../vouchers/vouchers';

export interface BackupCounts {
  invoices: number;
  products: number;
  customers: number;
  suppliers: number;
  chainEntries: number;
  lastInvoiceAt: number | null;
  [k: string]: number | null;
}

export async function backupCounts(db: Db): Promise<BackupCounts> {
  const one = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const last = await db.select({ t: sql<number>`max(${salesDocs.postedAt})` }).from(salesDocs).where(and(eq(salesDocs.type, 'INVOICE'), eq(salesDocs.status, 'POSTED')));
  return {
    invoices: await one(db.select({ n: count() }).from(salesDocs).where(and(eq(salesDocs.type, 'INVOICE'), eq(salesDocs.status, 'POSTED')))),
    products: await one(db.select({ n: count() }).from(products).where(sql`${products.deletedAt} IS NULL`)),
    customers: await one(db.select({ n: count() }).from(customers).where(sql`${customers.deletedAt} IS NULL`)),
    suppliers: await one(db.select({ n: count() }).from(suppliers).where(sql`${suppliers.deletedAt} IS NULL`)),
    chainEntries: await one(db.select({ n: count() }).from(integrityChain)),
    lastInvoiceAt: last[0]?.t ?? null,
  };
}

export async function businessName(db: Db): Promise<string | null> {
  return (await db.select({ name: business.name }).from(business).limit(1))[0]?.name ?? null;
}

const PREFIXES: Record<string, string> = {
  SALES_INVOICE: 'INV',
  SALES_RETURN: 'RET',
  QUOTATION: 'QUO',
  PURCHASE: 'PUR',
  PURCHASE_RETURN: 'PRT',
  INVENTORY: 'STK',
  SHIFT: 'SHF',
};

/** Run on the restored database (now the live DB of the new phone). Idempotent for the same device. */
export async function completeRestore(db: Db, reg: { deviceId: string; deviceCode: string }, opts: { platform: 'ios' | 'android'; backupId?: string | null; now?: number }) {
  const now = opts.now ?? Date.now();
  await withTx(db, async (tx) => {
    const prev = (await tx.select().from(devices).where(eq(devices.isCurrent, true)))[0] ?? null;
    await tx.update(devices).set({ isCurrent: false, deactivatedAt: now, updatedAt: now }).where(eq(devices.isCurrent, true));
    const exists = (await tx.select({ id: devices.id }).from(devices).where(eq(devices.id, reg.deviceId)))[0];
    if (exists) await tx.update(devices).set({ isCurrent: true, deactivatedAt: null, updatedAt: now }).where(eq(devices.id, reg.deviceId));
    else await tx.insert(devices).values({ id: reg.deviceId, code: reg.deviceCode, platform: opts.platform, isCurrent: true, activatedAt: now, createdAt: now, updatedAt: now, deviceId: reg.deviceId });
    await setMeta(tx, 'device_id', reg.deviceId);
    await setMeta(tx, 'device_code', reg.deviceCode);
    // New device → its own numbering (INV-B-000001…) so numbers never collide with the old phone's.
    const have = new Set((await tx.select({ t: docSequences.docType }).from(docSequences).where(eq(docSequences.deviceId, reg.deviceId))).map((r) => r.t));
    const old = prev ? await tx.select().from(docSequences).where(eq(docSequences.deviceId, prev.id)) : [];
    const types = new Map<string, string>([...Object.entries(PREFIXES), ...old.map((o) => [o.docType, o.prefix] as [string, string])]);
    for (const [docType, prefix] of types) if (!have.has(docType)) await tx.insert(docSequences).values({ deviceId: reg.deviceId, docType, prefix, nextSeq: 1 });
    await appendAudit(tx, { action: 'backup.restore', entity: 'devices', entityId: reg.deviceId, before: prev ? { device: prev.id, code: prev.code } : null, after: { code: reg.deviceCode, backup: opts.backupId ?? null }, deviceId: reg.deviceId, at: now });
  });
  await ensureInventorySeed(db, { id: reg.deviceId, code: reg.deviceCode }, now);
  // Older backups may have no expense types yet.
  await ensureExpenseCategories(db, { id: reg.deviceId, code: reg.deviceCode }, now);
}

/** Every table's rows, for the restore acceptance test (device-local rows excluded by the caller). */
export async function dumpTables(db: Db, tables: string[]): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = (await db.all(sql.raw(`SELECT * FROM "${t}" ORDER BY rowid`))) as unknown[];
  return out;
}

export { auditLog };
