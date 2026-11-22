/**
 * Ads state + entry points used by screens. The SDK lives behind `backend` (native: AdMob, web: no-op) so
 * the rest of the app never imports the ad SDK. Licence `showAds` already includes the server kill switch
 * (licence payload `ads_enabled`), so turning ads off never needs an app update.
 */
import { create } from 'zustand';
import { bannerAllowed, interstitialAllowed, type AdState } from './policy';
import { backend } from './backend';

export const useAds = create<AdState & { ready: boolean }>(() => ({ showAds: false, online: false, startedAt: Date.now(), lastInterstitialAt: -Infinity, ready: false }));

export function setAdInputs(p: { showAds?: boolean; online?: boolean }) {
  useAds.setState(p);
  const s = useAds.getState();
  if (s.showAds && s.online && !s.ready) {
    useAds.setState({ ready: true });
    void backend.init().catch(() => useAds.setState({ ready: false }));
  }
}

export function useBannerAllowed(place: string): boolean {
  return useAds((s) => s.ready && bannerAllowed(s, place, Date.now()));
}

/** Call after a finished non-sale task (export, closing a report). Never blocks the user. */
export function maybeShowInterstitial() {
  const s = useAds.getState();
  const now = Date.now();
  if (!s.ready || !interstitialAllowed(s, now)) return;
  useAds.setState({ lastInterstitialAt: now });
  void backend.showInterstitial().catch(() => undefined);
}
