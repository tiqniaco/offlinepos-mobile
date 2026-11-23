/** Feeds the ad state from the licence (showAds incl. server kill switch) and the network status. */
import { useEffect } from 'react';
import * as Network from 'expo-network';
import { useApp } from '../../state/app';
import { setAdInputs } from './ads';

export function AdsProvider() {
  // EXPO_PUBLIC_E2E_SHOW_ADS is set only in the emulator screenshot build (to photograph the free-plan ad slots).
  const showAds = useApp((s) => !!s.licence?.showAds) || process.env.EXPO_PUBLIC_E2E_SHOW_ADS === '1';
  useEffect(() => setAdInputs({ showAds }), [showAds]);
  useEffect(() => {
    void Network.getNetworkStateAsync().then((n) => setAdInputs({ online: !!n.isConnected && n.isInternetReachable !== false }), () => undefined);
    const sub = Network.addNetworkStateListener((n) => setAdInputs({ online: !!n.isConnected && n.isInternetReachable !== false }));
    return () => sub.remove();
  }, []);
  return null;
}
