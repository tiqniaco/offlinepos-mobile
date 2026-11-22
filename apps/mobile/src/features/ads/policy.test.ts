import { bannerAllowed, interstitialAllowed, INTERSTITIAL_GAP_MS, START_QUIET_MS } from './policy';

const base = { showAds: true, online: true, startedAt: 0, lastInterstitialAt: -Infinity };

describe('ad policy (PLAN.md §18)', () => {
  it('paid plans and offline phones never see ads', () => {
    expect(bannerAllowed({ ...base, showAds: false }, 'home', 1e9)).toBe(false);
    expect(bannerAllowed({ ...base, online: false }, 'home', 1e9)).toBe(false);
    expect(interstitialAllowed({ ...base, showAds: false }, 1e9)).toBe(false);
    expect(interstitialAllowed({ ...base, online: false }, 1e9)).toBe(false);
  });
  it('banners only in allowed places — never while selling', () => {
    for (const p of ['home', 'products', 'parties', 'reports', 'expenses', 'settings']) expect(bannerAllowed(base, p, 1)).toBe(true);
    for (const p of ['pos', 'pay', 'receipt', 'return', 'lock', 'onboarding', 'restore', 'form']) expect(bannerAllowed(base, p, 1)).toBe(false);
  });
  it('interstitial: not in the first 2 minutes, then at most every 15 minutes', () => {
    expect(interstitialAllowed(base, START_QUIET_MS - 1)).toBe(false);
    expect(interstitialAllowed(base, START_QUIET_MS)).toBe(true);
    const shown = { ...base, lastInterstitialAt: START_QUIET_MS };
    expect(interstitialAllowed(shown, START_QUIET_MS + INTERSTITIAL_GAP_MS - 1)).toBe(false);
    expect(interstitialAllowed(shown, START_QUIET_MS + INTERSTITIAL_GAP_MS)).toBe(true);
  });
});
