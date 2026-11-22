/** AdMob backend (react-native-google-mobile-ads): UMP consent → init → preloaded interstitial. */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import mobileAds, { AdEventType, AdsConsent, InterstitialAd, TestIds } from 'react-native-google-mobile-ads';

type AdIds = { bannerAndroid: string; bannerIos: string; interstitialAndroid: string; interstitialIos: string };
const ids = ((Constants.expoConfig?.extra as { admob?: AdIds } | undefined)?.admob ?? {}) as Partial<AdIds>;

export function bannerUnitId(): string {
  const real = Platform.OS === 'ios' ? ids.bannerIos : ids.bannerAndroid;
  return __DEV__ || !real ? TestIds.ADAPTIVE_BANNER : real;
}
function interstitialUnitId(): string {
  const real = Platform.OS === 'ios' ? ids.interstitialIos : ids.interstitialAndroid;
  return __DEV__ || !real ? TestIds.INTERSTITIAL : real;
}

let personalised = false;
let interstitial: InterstitialAd | null = null;
let loaded = false;

function preload() {
  interstitial = InterstitialAd.createForAdRequest(interstitialUnitId(), { requestNonPersonalizedAdsOnly: !personalised });
  loaded = false;
  interstitial.addAdEventListener(AdEventType.LOADED, () => (loaded = true));
  interstitial.addAdEventListener(AdEventType.CLOSED, () => preload());
  interstitial.addAdEventListener(AdEventType.ERROR, () => (loaded = false));
  interstitial.load();
}

export function adRequestOptions() {
  return { requestNonPersonalizedAdsOnly: !personalised };
}

export const backend = {
  async init(): Promise<void> {
    try {
      // Google UMP: shows the consent form only where required (EEA/UK…); returns immediately elsewhere.
      const info = await AdsConsent.gatherConsent();
      personalised = !!info.canRequestAds && (await AdsConsent.getUserChoices()).selectPersonalisedAds;
      if (!info.canRequestAds) return;
    } catch {
      personalised = false;
    }
    await mobileAds().initialize();
    preload();
  },
  async showInterstitial(): Promise<void> {
    if (interstitial && loaded) await interstitial.show();
  },
};
