/** Default warehouse and standard units. Idempotent: safe to run at every start. */
import { HybridLogicalClock, uuidv7 } from '@daftarak/shared';
import { units, warehouses } from '../../db/schema';
import type { Db } from '../../db/types';
import { ensureAccounts } from '../accounting/journal';

const STANDARD_UNITS: { ar: string; en: string; fraction: boolean }[] = [
  { ar: 'قطعة', en: 'Piece', fraction: false },
  { ar: 'كرتونة', en: 'Carton', fraction: false },
  { ar: 'علبة', en: 'Box', fraction: false },
  { ar: 'دستة', en: 'Dozen', fraction: false },
  { ar: 'باكو', en: 'Pack', fraction: false },
  { ar: 'زجاجة', en: 'Bottle', fraction: false },
  { ar: 'كيلو', en: 'Kg', fraction: true },
  { ar: 'جرام', en: 'Gram', fraction: true },
  { ar: 'لتر', en: 'Litre', fraction: true },
  { ar: 'متر', en: 'Metre', fraction: true },
];

export async function ensureInventorySeed(db: Db, device: { id: string; code: string }, now = Date.now()) {
  await ensureAccounts(db, device.id, now);
  const hlc = new HybridLogicalClock(device.code, () => now);
  const wh = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
  if (wh.length === 0) {
    await db.insert(warehouses).values({ id: uuidv7(now), name: 'المخزن الرئيسي', isDefault: true, createdAt: now, updatedAt: now, deviceId: device.id, hlc: hlc.tick() });
  }
  const u = await db.select({ id: units.id }).from(units).limit(1);
  if (u.length === 0) {
    let sort = 0;
    for (const s of STANDARD_UNITS) {
      await db.insert(units).values({ id: uuidv7(now), nameAr: s.ar, nameEn: s.en, allowsFraction: s.fraction, sort: sort++, createdAt: now, updatedAt: now, deviceId: device.id, hlc: hlc.tick() });
    }
  }
}
