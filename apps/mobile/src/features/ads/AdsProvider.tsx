/** Feeds the ad state from the licence (showAds incl. server kill switch) and the network status. */
import { useEffect } from 'react';
import * as Network from 'expo-network';
import { useApp } from '../../state/app';
import { setAdInputs } from './ads';

export function AdsProvider() {
  const showAds = useApp((s) => !!s.licence?.showAds);
  useEffect(() => setAdInputs({ showAds }), [showAds]);
  useEffect(() => {
    void Network.getNetworkStateAsync().then((n) => setAdInputs({ online: !!n.isConnected && n.isInternetReachable !== false }), () => undefined);
    const sub = Network.addNetworkStateListener((n) => setAdInputs({ online: !!n.isConnected && n.isInternetReachable !== false }));
    return () => sub.remove();
  }, []);
  return null;
}
