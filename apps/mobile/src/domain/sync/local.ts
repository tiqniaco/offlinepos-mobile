/** Cashier phone joining a shop: writes the local shop from the join answer + the shop's catalog. */
import { uuidv7, type SyncJoinResponse } from '@daftarak/shared';
import { business, devices, docSequences } from '../../db/schema';
import type { Db } from '../../db/types';
import { withTx } from '../../db/tx';
import { appendAudit } from '../audit/audit';
import { setMeta } from '../device';
import { ensureInventorySeed } from '../inventory/seed';
import { installCatalog, type Catalog } from './catalog';
import { savePhoneRole } from './role';

export const CASHIER_DOC_PREFIXES: Record<string, string> = { SALES_INVOICE: 'INV', SALES_RETURN: 'RET', QUOTATION: 'QUO', RECEIPT: 'RCV', SHIFT: 'SHF' };

export async function writeCashierLocal(db: Db, j: Pick<SyncJoinResponse, 'business' | 'deviceId' | 'deviceCode'>, syncKey: string, catalog: Catalog, platform: 'android' | 'ios', now = Date.now()) {
  const already = (await db.select({ id: business.serverBusinessId }).from(business).limit(1))[0];
  if (already && already.id !== j.business.id) throw new Error('business_exists');
  if (!already) {
    const b = catalog.business;
    await withTx(db, async (tx) => {
      await setMeta(tx, 'device_id', j.deviceId);
      await setMeta(tx, 'device_code', j.deviceCode);
      await setMeta(tx, 'sync.key', syncKey);
      await tx.insert(devices).values({ id: j.deviceId, code: j.deviceCode, platform, isCurrent: true, activatedAt: now, createdAt: now, updatedAt: now, deviceId: j.deviceId });
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
      for (const [docType, prefix] of Object.entries(CASHIER_DOC_PREFIXES)) await tx.insert(docSequences).values({ deviceId: j.deviceId, docType, prefix, nextSeq: 1 });
      await appendAudit(tx, { action: 'device.join', entity: 'devices', entityId: j.deviceId, after: { code: j.deviceCode, role: 'cashier' }, deviceId: j.deviceId, at: now });
    });
  }
  await savePhoneRole(db, 'cashier');
  await installCatalog(db, catalog);
  await ensureInventorySeed(db, { id: j.deviceId, code: j.deviceCode }, now);
  await setMeta(db, 'sync.catalogAt', String(catalog.at));
}
