/**
 * Cashier phone joining a shop: the shop, this phone and the shop's catalog are written in ONE transaction (a join cut
 * by a crash leaves nothing half-done). Joining again (new QR after the phone was removed) re-binds this phone to its
 * new server device; its unsent sales stay queued and are delivered under the new device.
 */
import { uuidv7, type SyncJoinResponse } from '@daftarak/shared';
import { business, devices, docSequences } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { getMeta, setMeta } from '../device';
import { ensureInventorySeed } from '../inventory/seed';
import { installCatalogTx, type Catalog } from './catalog';
import { setCashierStopped, setPhoneRole } from './role';

export const CASHIER_DOC_PREFIXES: Record<string, string> = { SALES_INVOICE: 'INV', SALES_RETURN: 'RET', QUOTATION: 'QUO', RECEIPT: 'RCV', SHIFT: 'SHF' };

export async function writeCashierLocal(db: Db, j: Pick<SyncJoinResponse, 'business' | 'deviceId' | 'deviceCode'>, syncKey: string, catalog: Catalog, platform: 'android' | 'ios', now = Date.now()) {
  const already = (await db.select({ id: business.serverBusinessId }).from(business).limit(1))[0];
  if (already && already.id !== j.business.id) throw new Error('business_exists');
  if (already && (await getMeta(db, 'sync.role')) !== 'cashier') throw new Error('business_exists');
  const b = catalog.business;
  await withTx(db, async (tx) => {
    await setMeta(tx, 'device_id', j.deviceId);
    await setMeta(tx, 'device_code', j.deviceCode);
    await setMeta(tx, 'sync.key', syncKey);
    await setMeta(tx, 'sync.role', 'cashier');
    await setMeta(tx, 'sync.stopped', '0');
    await tx.update(devices).set({ isCurrent: false });
    await tx.insert(devices).values({ id: j.deviceId, code: j.deviceCode, platform, isCurrent: true, activatedAt: now, createdAt: now, updatedAt: now, deviceId: j.deviceId }).onConflictDoNothing();
    if (!already) {
      await tx.insert(business).values({
        id: uuidv7(now),
        serverBusinessId: j.business.id,
        name: j.business.name,
        country: j.business.country,
        type: j.business.type,
        currency: (b.currency as 'EGP' | 'SAR') ?? (j.business.country === 'SA' ? 'SAR' : 'EGP'),
        vatRegistered: !!b.vatRegistered,
        vatNumber: (b.vatNumber as string | null) ?? null,
        timezone: (b.timezone as string) ?? 'Africa/Cairo',
        phonesJson: String(b.phonesJson ?? '[]'),
        createdAt: now,
        updatedAt: now,
        deviceId: j.deviceId,
      });
    }
    for (const [docType, prefix] of Object.entries(CASHIER_DOC_PREFIXES)) await tx.insert(docSequences).values({ deviceId: j.deviceId, docType, prefix, nextSeq: 1 }).onConflictDoNothing();
    await installCatalogTx(tx, catalog, j.deviceId);
    await appendAudit(tx, { action: 'device.join', entity: 'devices', entityId: j.deviceId, after: { code: j.deviceCode, role: 'cashier', rejoin: !!already }, deviceId: j.deviceId, at: now });
  });
  setPhoneRole('cashier');
  setCashierStopped(false);
  await ensureInventorySeed(db, { id: j.deviceId, code: j.deviceCode }, now);
  await setMeta(db, 'sync.catalogAt', String(catalog.at));
}
