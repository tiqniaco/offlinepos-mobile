/**
 * App start (PLAN.md §3.1): open encrypted DB → settings & language → licence (offline) → lock screen.
 * The daily check-in runs in the background afterwards and never blocks start-up.
 */
import { Appearance, Platform } from 'react-native';
import { applyFont, applyTheme, setTextSize } from '../ui/themeStore';
import { preloadSounds, setSoundsEnabled } from '../ui/sounds';
import { getDb, openDatabase, DbNotEncryptedError } from '../db/client';
import { business } from '../db/schema';
import { getCurrentDevice } from '../domain/device';
import { ensureInventorySeed } from '../domain/inventory/seed';
import { ensureExpenseCategories } from '../domain/vouchers/vouchers';
import { loadSettings } from '../domain/settings/settings';
import { checkinDue, hooks, refreshLicenceState, runCheckin } from '../domain/licence/service';
import { integrityToken } from '../features/integrity/integrity';
import { pushToken, showAnnouncements } from '../features/notify/notify';
import { getMeta, setMeta } from '../domain/device';
import { isUnlinked } from '../domain/backup/portable';
import { finishAutoBackup, markCommitted, pendingBackupId, prepareAutoBackup } from '../features/backup/service';

// Daily automatic backup rides on the check-in (features/backup/service.ts).
hooks.prepareBackup = prepareAutoBackup;
hooks.pendingBackupId = pendingBackupId;
// Device integrity once a week (Google/Apple quotas; the server only records it at check-in).
hooks.integrity = async () => {
  const db = getDb();
  const last = Number((await getMeta(db, 'integrity.at')) ?? 0);
  if (Date.now() - last < 7 * 86_400_000) return undefined;
  const tok = await integrityToken('checkin');
  if (tok) await setMeta(db, 'integrity.at', String(Date.now()));
  return tok;
};
hooks.pushToken = pushToken;
hooks.onAnnouncements = async (fresh) => {
  useApp.getState().set({ inboxBump: Date.now() });
  await showAnnouncements(fresh);
};
hooks.afterCheckin = async (put, committed) => {
  await markCommitted(committed);
  void finishAutoBackup(put);
};
import { subscribeLicence } from '../domain/licence/guard';
import { ensureDirection, initI18n } from '../i18n';
import { useApp } from './app';

let subscribed = false;

export async function boot(): Promise<void> {
  const set = useApp.getState().set;
  if (Platform.OS === 'web') {
    await applyFont('readex').catch(() => undefined);
    // The product is mobile-only. Web is used ONLY to preview onboarding screens during design work:
    // no database, no secure storage, nothing is saved.
    initI18n('ar');
    if (typeof document !== 'undefined') document.documentElement.dir = 'rtl';
    set({ status: 'onboarding' });
    return;
  }
  try {
    await openDatabase();
  } catch (e) {
    initI18n('ar');
    await applyFont('readex').catch(() => undefined);
    set({ status: 'fatal', fatal: e instanceof DbNotEncryptedError ? 'db_not_encrypted' : 'db_open_failed' });
    return;
  }
  const db = getDb();
  if (!subscribed) {
    subscribeLicence((l) => useApp.getState().set({ licence: l }));
    subscribed = true;
  }
  const settings = await loadSettings(db);
  setTextSize(settings.textSize ?? 'md');
  setSoundsEnabled(settings.sounds ?? true);
  preloadSounds();
  await applyFont(settings.font ?? 'readex').catch(() => applyFont('readex'));
  applyTheme(settings.palette ?? 'tiqnia', settings.appearance ?? 'light', Appearance.getColorScheme() === 'dark');
  const lang = settings.language ?? 'ar';
  initI18n(lang);
  if (await ensureDirection(lang)) return; // app is reloading
  const b = (await db.select().from(business).limit(1))[0];
  if (!b) {
    set({ status: 'onboarding', settings });
    return;
  }
  const device = await getCurrentDevice(db);
  if (device) {
    await ensureInventorySeed(db, device);
    await ensureExpenseCategories(db, device);
  }
  await refreshLicenceState(db);
  set({
    restoreUnlinked: await isUnlinked(db),
    status: 'locked',
    settings,
    device,
    business: { name: b.name, country: b.country, type: b.type, currency: b.currency, serverBusinessId: b.serverBusinessId },
  });
  void backgroundCheckin();
}

/** Daily check-in when due. Offline is normal and silent. */
export async function backgroundCheckin(force = false) {
  const db = getDb();
  if (!force && !(await checkinDue(db))) return null;
  return runCheckin(db);
}

/** Reload settings & business into the store after onboarding or a settings change. */
export async function reloadAppData() {
  const db = getDb();
  const settings = await loadSettings(db);
  const b = (await db.select().from(business).limit(1))[0];
  useApp.getState().set({
    settings,
    device: await getCurrentDevice(db),
    business: b ? { name: b.name, country: b.country, type: b.type, currency: b.currency, serverBusinessId: b.serverBusinessId } : null,
  });
}

/** Cold-start timing (JS start → first interactive screen), kept for the About line and diagnostics. */
export const startedAt = Date.now();
export function markInteractive() {
  const ms = Date.now() - startedAt;
  if (__DEV__) console.log(`[startup] interactive in ${ms} ms`);
  return ms;
}
