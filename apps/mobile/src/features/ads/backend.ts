/** Web / test backend: no ads. The native build uses backend.native.ts (AdMob). */
export const backend = {
  async init(): Promise<void> {},
  async showInterstitial(): Promise<void> {},
};
