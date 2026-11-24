/**
 * In-app updates. The server says which version is the latest and which is the minimum (newest *enforced* forced
 * release). Below the minimum the app is blocked until it updates; a forced release is only enforced after its
 * grace (`forceAt`, 48 h by default) — until then it is an optional update plus a banner. Otherwise a soft prompt.
 * Sideload builds (default): download the APK (same signing key) and hand it to the system installer.
 * Store builds (extra.storeBuild / STORE_BUILD=1): ask with channel=store and open the store listing instead.
 */
import { AppState, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { create } from 'zustand';
import { API_URL } from '../../config/env';

export interface Release {
  code: number;
  name: string;
  url: string | null;
  sha256: string | null;
  size: number | null;
  notesAr: string | null;
}

interface UpdateState {
  latest: Release | null;
  forced: boolean;
  /** A forced release that becomes mandatory at this time (ms); before that: optional + banner. */
  forceAt: number | null;
  /** Android: show the "allow installing from this app" explainer before the installer. */
  unknownSources: Release | null;
  /** Version the user chose "later" for (soft prompt only). */
  snoozed: number | null;
  progress: number | null;
  error: string | null;
  set: (p: Partial<UpdateState>) => void;
}

export const useUpdate = create<UpdateState>((set) => ({ latest: null, forced: false, forceAt: null, unknownSources: null, snoozed: null, progress: null, error: null, set: (p) => set(p) }));

const extra = () => (Constants.expoConfig?.extra ?? {}) as { storeBuild?: boolean; appStoreId?: string };
/** Play / App Store build: store billing only, updates from the store. */
/** iOS apps only come from the App Store (or TestFlight): always a store build (Apple's in-app purchase only). */
export const isStoreBuild = () => Platform.OS === 'ios' || !!extra().storeBuild;

/** Store listing of this app (fallback when the release row has no URL). */
export function storeListingUrl(): string {
  if (Platform.OS === 'ios') return extra().appStoreId ? `https://apps.apple.com/app/id${extra().appStoreId}` : 'https://apps.apple.com/';
  return `https://play.google.com/store/apps/details?id=${Application.applicationId ?? 'app.daftarak'}`;
}

export const currentCode = () => Number(Application.nativeBuildVersion ?? 0) || 0;

let lastCheck = 0;
export async function checkForUpdate(force = false) {
  if (Platform.OS === 'web') return;
  if (!force && Date.now() - lastCheck < 3 * 3_600_000) return;
  lastCheck = Date.now();
  try {
    const channel = isStoreBuild() ? 'store' : 'sideload';
    const res = await fetch(`${API_URL}/v1/app/latest?platform=${Platform.OS}&channel=${channel}`);
    if (!res.ok) return;
    const j = (await res.json()) as { latest: Release | null; minCode: number; pendingMinCode?: number; forceAt?: number };
    const cur = currentCode();
    if (!j.latest || j.latest.code <= cur) return useUpdate.getState().set({ latest: null, forced: false, forceAt: null });
    const latest = channel === 'store' ? { ...j.latest, url: j.latest.url ?? storeListingUrl() } : j.latest;
    const forceAt = j.pendingMinCode && cur < j.pendingMinCode && j.forceAt ? j.forceAt : null;
    // A soon-mandatory update is shown again on every check (≤ every 3 h) even after «بعدين».
    useUpdate.getState().set({ latest, forced: cur < j.minCode, forceAt, ...(forceAt ? { snoozed: null } : {}) });
  } catch {
    /* offline: try again later */
  }
}

/** Check on start and whenever the app comes back to the foreground (at most every 3 hours). */
export function watchForUpdates() {
  void checkForUpdate(true);
  const sub = AppState.addEventListener('change', (s) => s === 'active' && void checkForUpdate());
  return () => sub.remove();
}

/** SHA-256 (hex) computed natively by expo-file-system (`File.digest`, streamed; not in its TS types yet). */
async function sha256OfFile(file: File): Promise<string | null> {
  const digest = (file as unknown as { digest?: (algorithm: 'SHA-256') => Promise<string> }).digest;
  if (typeof digest !== 'function') return null;
  return digest.call(file, 'SHA-256');
}

/** Remembered once the owner went through the "unknown apps" settings (no native check exists in Expo). */
const unknownSourcesFlag = () => new File(Paths.document, 'unknown-sources-ok');

/** Android 8+: the per-app "install unknown apps" switch (ACTION_MANAGE_UNKNOWN_APP_SOURCES for this package). */
export async function openUnknownSourcesSettings(): Promise<void> {
  try {
    await IntentLauncher.startActivityAsync('android.settings.MANAGE_UNKNOWN_APP_SOURCES', { data: `package:${Application.applicationId ?? 'app.daftarak'}` });
  } catch {
    await IntentLauncher.startActivityAsync('android.settings.SECURITY_SETTINGS').catch(() => undefined);
  }
  try {
    const f = unknownSourcesFlag();
    if (!f.exists) f.create();
  } catch {
    /* best effort */
  }
}

/** Called by the explainer's button: settings first, then the download + installer. */
export async function allowUnknownSourcesAndInstall() {
  const r = useUpdate.getState().unknownSources;
  useUpdate.getState().set({ unknownSources: null });
  await openUnknownSourcesSettings();
  if (r) await installUpdate(r, true);
}

export async function installUpdate(r: Release, skipExplainer = false) {
  const st = useUpdate.getState();
  if (!r.url) return;
  if (isStoreBuild() || Platform.OS !== 'android' || !r.url.endsWith('.apk')) {
    await Linking.openURL(r.url);
    return;
  }
  // Android 8+ asks for "install unknown apps" per app: explain it once before sending the owner to the switch.
  let explained = skipExplainer;
  try {
    explained = explained || unknownSourcesFlag().exists;
  } catch {
    explained = true;
  }
  if (!explained && Number(Platform.Version) >= 26) {
    st.set({ unknownSources: r });
    return;
  }
  st.set({ progress: 0, error: null });
  try {
    const dest = new File(Paths.cache, `kashiro-${r.code}.apk`);
    if (dest.exists) dest.delete();
    const task = File.createDownloadTask(r.url, dest, {
      onProgress: ({ bytesWritten, totalBytes }) => {
        const total = totalBytes > 0 ? totalBytes : (r.size ?? 0);
        if (total > 0) useUpdate.getState().set({ progress: Math.min(0.99, bytesWritten / total) });
      },
    });
    const file = await task.downloadAsync();
    if (!file) throw new Error('download');
    // Never hand a corrupted / tampered APK to the installer: it must match the hash the server published.
    if (r.sha256) {
      const got = await sha256OfFile(file);
      if (!got || got.toLowerCase() !== r.sha256.toLowerCase()) {
        if (file.exists) file.delete();
        useUpdate.getState().set({ progress: null, error: 'checksum' });
        return;
      }
    }
    useUpdate.getState().set({ progress: 1 });
    const contentUri = await getContentUriAsync(file.uri);
    // FLAG_GRANT_READ_URI_PERMISSION (1): the installer reads our cached APK.
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, flags: 1, type: 'application/vnd.android.package-archive' });
    useUpdate.getState().set({ progress: null });
  } catch {
    useUpdate.getState().set({ progress: null, error: 'download' });
  }
}
