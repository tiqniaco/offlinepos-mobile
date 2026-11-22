/** Typed access to the settings table (values seeded from country/type profile at onboarding). */
import { eq } from 'drizzle-orm';
import type { BusinessSettings } from '@daftarak/shared';
import type { Db as AppDb } from '../../db/types';
import { withTx } from '../../db/tx';
import { settings } from '../../db/schema';
import { appendAudit } from '../audit/audit';
import { assertCanWrite } from '../licence/guard';

export type SettingKey = keyof BusinessSettings | 'language' | 'palette' | 'appearance';
/** palette/appearance are personal display settings (src/ui/theme.ts). */
export type AppSettings = BusinessSettings & { language: 'ar' | 'en'; palette: 'tiqnia' | 'teal' | 'emerald' | 'sunset' | 'graphite'; appearance: 'light' | 'dark' | 'comfort' | 'system' };

export async function loadSettings(db: AppDb): Promise<Partial<AppSettings>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.valueJson) as unknown])) as Partial<AppSettings>;
}

export async function writeSettings(tx: Pick<AppDb, 'insert'>, values: Partial<AppSettings>, now: number) {
  for (const [key, value] of Object.entries(values)) {
    const valueJson = JSON.stringify(value);
    await tx.insert(settings).values({ key, valueJson, updatedAt: now }).onConflictDoUpdate({ target: settings.key, set: { valueJson, updatedAt: now } });
  }
}

/** Change one setting with an audit entry. Language and lock time are personal → allowed even read-only. */
export async function changeSetting<K extends SettingKey>(
  db: AppDb,
  key: K,
  value: AppSettings[K],
  ctx: { userId: string; deviceId: string },
): Promise<void> {
  const personal = key === 'language' || key === 'autoLockMinutes' || key === 'palette' || key === 'appearance';
  if (!personal) assertCanWrite();
  const now = Date.now();
  await withTx(db, async (tx) => {
    const before = await tx.select().from(settings).where(eq(settings.key, key)).limit(1);
    await writeSettings(tx, { [key]: value } as Partial<AppSettings>, now);
    await appendAudit(tx, {
      action: 'settings.change',
      entity: 'settings',
      entityId: key,
      before: before[0] ? JSON.parse(before[0].valueJson) : null,
      after: value,
      userId: ctx.userId,
      deviceId: ctx.deviceId,
      at: now,
    });
  });
}
