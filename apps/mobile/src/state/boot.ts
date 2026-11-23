/**
 * App start (PLAN.md §3.1): open encrypted DB → settings & language → licence (offline) → lock screen.
 * The daily check-in runs in the background afterwards and never blocks start-up.
 */
import { Appearance, Platform } from 'react-native';
import { applyFont, applyTheme, setTextSize } from '../ui/themeStore';
import { preloadSoundsSoon, setSoundsEnabled, setSoundVolume } from '../ui/sounds';
import { setHapticsEnabled } from '../ui/haptics';
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
import { finishAutoBackup, markCommitted, pendingBackupId, prepareAutoBackup, abandonIncompleteRestore } from '../features/backup/service';
import { cleanBackupCache } from '../features/backup/files';
import { flushPendingErrors, reportClientError } from '../features/errors/CrashScreen';

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
import { bumpData, useApp } from './app';
import { onDataCommitted } from '../db/tx';

// Any committed posting (sale, purchase, voucher, stock change, void…) bumps the store's data counter.
onDataCommitted(bumpData);

let subscribed = false;

/**
 * Never leaves the app on a blank splash: any failure during start-up shows the fatal screen (retry, send report,
 * restore from a backup, WhatsApp support) and is reported.
 */
export async function boot(): Promise<void> {
  try {
    await bootInner();
  } catch (e) {
    reportClientError(e, 'boot');
    try {
      initI18n(useApp.getState().settings.language ?? 'ar');
    } catch {
      /* keep going: the fatal screen has Arabic fallbacks */
    }
    await applyFont('readex').catch(() => undefined);
    const msg = e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}` : String(e);
    useApp.getState().set({ status: 'fatal', fatal: 'boot_failed', fatalDetail: msg });
  }
}

async function bootInner(): Promise<void> {
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
  void flushPendingErrors();
  // Leftovers of a backup/restore interrupted by a crash (plain-text snapshot copies): never keep them.
  cleanBackupCache();
  try {
    await openDatabase();
  } catch (e) {
    initI18n('ar');
    await applyFont('readex').catch(() => undefined);
    reportClientError(e, 'db_open');
    set({ status: 'fatal', fatal: e instanceof DbNotEncryptedError ? 'db_not_encrypted' : 'db_open_failed', fatalDetail: e instanceof Error ? e.message : String(e) });
    return;
  }
  // A cloud restore installed but never activated (app killed in between): set that data aside → onboarding.
  if (await abandonIncompleteRestore()) await openDatabase();
  const db = getDb();
  if (!subscribed) {
    subscribeLicence((l) => useApp.getState().set({ licence: l }));
    subscribed = true;
  }
  const settings = await loadSettings(db);
  setTextSize(settings.textSize ?? 'md');
  setSoundsEnabled(settings.sounds ?? true);
  setSoundVolume(settings.soundVolume ?? 'medium');
  setHapticsEnabled(settings.haptics ?? true);
  preloadSoundsSoon(); // after the first screen is up: never delays startup
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
  void backgroundCheckin().catch(() => undefined);
}

type CheckinResult = Awaited<ReturnType<typeof runCheckin>> | null;
let inflight: Promise<CheckinResult> | null = null;

/**
 * Daily check-in when due. Offline is normal and silent.
 * Single-flight: boot, auto-lock, the licence banner and the subscription screen can all ask at once; they share
 * one request so two check-ins never race on the backup snapshot / licence state.
 */
export function backgroundCheckin(force = false): Promise<CheckinResult> {
  if (inflight) return force ? inflight.then((r) => r ?? backgroundCheckin(true)) : inflight;
  const run = (async () => {
    const db = getDb();
    if (!force && !(await checkinDue(db))) return null;
    return runCheckin(db);
  })();
  const p = run.finally(() => {
    if (inflight === p) inflight = null;
  });
  inflight = p;
  return p;
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
