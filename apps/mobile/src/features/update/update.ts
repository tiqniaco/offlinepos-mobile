/**
 * In-app updates outside the store. The server says which version is the latest and which is the minimum
 * (newest *forced* release). Below the minimum the app is blocked until it updates; otherwise a soft prompt.
 * Android: download the APK (same signing key) and hand it to the system installer.
 */
import { AppState, Linking, Platform } from 'react-native';
import * as Application from 'expo-application';
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
  /** Version the user chose "later" for (soft prompt only). */
  snoozed: number | null;
  progress: number | null;
  error: string | null;
  set: (p: Partial<UpdateState>) => void;
}

export const useUpdate = create<UpdateState>((set) => ({ latest: null, forced: false, snoozed: null, progress: null, error: null, set: (p) => set(p) }));

export const currentCode = () => Number(Application.nativeBuildVersion ?? 0) || 0;

let lastCheck = 0;
export async function checkForUpdate(force = false) {
  if (Platform.OS === 'web') return;
  if (!force && Date.now() - lastCheck < 3 * 3_600_000) return;
  lastCheck = Date.now();
  try {
    const res = await fetch(`${API_URL}/v1/app/latest?platform=${Platform.OS}`);
    if (!res.ok) return;
    const j = (await res.json()) as { latest: Release | null; minCode: number };
    const cur = currentCode();
    if (!j.latest || j.latest.code <= cur) return useUpdate.getState().set({ latest: null, forced: false });
    useUpdate.getState().set({ latest: j.latest, forced: cur < j.minCode });
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

export async function installUpdate(r: Release) {
  const st = useUpdate.getState();
  if (!r.url) return;
  if (Platform.OS !== 'android' || !r.url.endsWith('.apk')) {
    await Linking.openURL(r.url);
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
