/** Typed access to the settings table (values seeded from country/type profile at onboarding). */
import { eq } from 'drizzle-orm';
import { roleHas, type BusinessSettings, type Permission } from '@daftarak/shared';
import type { Db as AppDb } from '../../db/types';
import { withTx } from '../../db/tx';
import { settings } from '../../db/schema';
import { appendAudit } from '../audit/audit';
import { assertCanWrite } from '../licence/guard';
import { PermissionError } from '../auth/users';

export type SettingKey = keyof BusinessSettings | 'language' | 'palette' | 'appearance' | 'font' | 'textSize' | 'sounds' | 'soundVolume' | 'haptics' | 'notifications' | 'tipsSeen' | 'blockScreenshots' | 'printer' | 'receipt' | 'cashRoundingMinor' | 'requireShift' | 'reminderDays' | 'reminderTemplate' | 'defaultMarkupBp' | 'priceRoundingMinor';
/** palette/appearance are personal display settings (src/ui/theme.ts). */
export type AppSettings = BusinessSettings & { language: 'ar' | 'en'; palette: 'tiqnia' | 'teal' | 'emerald' | 'sunset' | 'graphite'; appearance: 'light' | 'dark' | 'comfort' | 'system';
  font: 'readex' | 'alexandria' | 'almarai' | 'plex';
  textSize: 'sm' | 'md' | 'lg';
  /** UI sounds (scan beep, sale chime…). Default on. */
  sounds: boolean;
  /** UI sound level. Default medium. */
  soundVolume: 'low' | 'medium' | 'high';
  /** Vibration feedback on taps/scans/sales. Default on. */
  haptics: boolean;
  /** Local reminders (morning summary, trial ending, backup). Default on. */
  notifications: boolean;
  /** First-use tips already dismissed. */
  tipsSeen: string[];
  /** Block screenshots on profit/cost/backup screens. Default off. */
  blockScreenshots: boolean;
  /** This phone's default printer (PLAN.md §10). */
  printer: import('../../features/printing/types').PrinterConfig | null;
  receipt: ReceiptTemplate;
  cashRoundingMinor: number;
  /** Selling and cash movements need an open cash shift. */
  requireShift: boolean;
  /** A customer is "late" when the oldest unpaid amount is older than this (days). */
  reminderDays: number;
  /** WhatsApp reminder text; {name} {amount} {business} {days}. */
  reminderTemplate: string;
  /** Default markup on cost for products added automatically (basis points; default 2000 = 20 %). */
  defaultMarkupBp: number;
  /** Sale prices made from the markup are rounded UP to this step (minor units: 0 / 25 / 50 / 100; default 50). */
  priceRoundingMinor: number;
};

/** Receipt / invoice template options (SPEC §3 + «شكل الفواتير»). Every field has a good default. */
export interface ReceiptTemplate {
  footer: string;
  showLogo: boolean;
  /** VAT breakdown (net + VAT lines). */
  showTax: boolean;
  showDiscount: boolean;
  showBalance: boolean;
  /** Preview / default thermal paper (the configured printer's own width wins when printing). */
  thermalSize?: 58 | 80;
  a4Style?: 'classic' | 'modern';
  /** Brand accent for A4 (#RRGGBB); null = the app's current theme colour. */
  brandColor?: string | null;
  showCashier?: boolean;
  showItemCode?: boolean;
  showQr?: boolean;
  /** A4: total in Arabic words (تفقيط). */
  showWords?: boolean;
  headerNote?: string;
  quoteTerms?: string;
  quoteValidDays?: number;
}
export const DEFAULT_RECEIPT: Required<ReceiptTemplate> = {
  footer: 'شكراً لزيارتكم 🌷',
  showLogo: true,
  showTax: true,
  showDiscount: true,
  showBalance: true,
  thermalSize: 80,
  a4Style: 'modern',
  brandColor: null,
  showCashier: true,
  showItemCode: false,
  showQr: true,
  showWords: true,
  headerNote: '',
  quoteTerms: 'الأسعار سارية حتى تاريخ الصلاحية المذكور. التوريد حسب توفر الكميات.',
  quoteValidDays: 7,
};

/** Saved template on top of the defaults (older saves miss the newer fields). */
export function resolveTemplate(saved: Partial<ReceiptTemplate> | null | undefined): Required<ReceiptTemplate> {
  const out = { ...DEFAULT_RECEIPT } as Required<ReceiptTemplate>;
  for (const [k, v] of Object.entries(saved ?? {})) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

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

/** Security settings that protect the whole shop: only someone with settings.manage may change them. */
const MANAGED_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>(['autoLockMinutes', 'blockScreenshots', 'negativeStock', 'wallets', 'defaultMarkupBp', 'priceRoundingMinor']);

/** Change one setting with an audit entry. Language and lock time are personal → allowed even read-only. */
export async function changeSetting<K extends SettingKey>(
  db: AppDb,
  key: K,
  value: AppSettings[K],
  ctx: { userId: string; deviceId: string; permissions?: readonly Permission[] },
): Promise<void> {
  if (MANAGED_KEYS.has(key) && !(ctx.permissions && roleHas(ctx.permissions, 'settings.manage'))) throw new PermissionError('settings.manage');
  const personal = key === 'language' || key === 'autoLockMinutes' || key === 'palette' || key === 'appearance' || key === 'font' || key === 'textSize' || key === 'sounds' || key === 'soundVolume' || key === 'haptics' || key === 'notifications' || key === 'tipsSeen' || key === 'printer';
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
