/**
 * Ad rules (PLAN.md §18, owner decision D-20) as pure functions so they are unit-tested:
 * - only on plans without `no_ads`, only when online, never in the first 2 minutes after start;
 * - banners only in allowed places (never POS, payment, receipt/printing, returns, lock, onboarding, forms);
 * - interstitial at most once every 15 minutes, only after finishing a non-sale task (export, closing a report).
 */
export const AD_PLACES = ['home', 'products', 'parties', 'reports', 'expenses', 'settings', 'purchases'] as const;
export type AdPlace = (typeof AD_PLACES)[number];

export const INTERSTITIAL_GAP_MS = 15 * 60_000;
export const START_QUIET_MS = 2 * 60_000;

export interface AdState {
  showAds: boolean;
  online: boolean;
  startedAt: number;
  lastInterstitialAt: number;
}

export function bannerAllowed(s: AdState, place: string, now: number): boolean {
  return s.showAds && s.online && (AD_PLACES as readonly string[]).includes(place) && now - s.startedAt >= 0;
}

export function interstitialAllowed(s: AdState, now: number): boolean {
  return s.showAds && s.online && now - s.startedAt >= START_QUIET_MS && now - s.lastInterstitialAt >= INTERSTITIAL_GAP_MS;
}

export function isAdPlace(place: string): boolean {
  return (AD_PLACES as readonly string[]).includes(place);
}
