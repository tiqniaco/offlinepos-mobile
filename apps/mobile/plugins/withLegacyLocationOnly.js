/**
 * Bluetooth libraries declare ACCESS_FINE_LOCATION for every Android version. Location is only needed for
 * Bluetooth scanning on Android ≤ 11 (12+ uses BLUETOOTH_SCAN with neverForLocation), so cap it at SDK 30.
 */
const { withAndroidManifest } = require('expo/config-plugins');

const NAMES = ['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'];

module.exports = function withLegacyLocationOnly(config) {
  return withAndroidManifest(config, (c) => {
    const m = c.modResults.manifest;
    m.$['xmlns:tools'] = m.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    m['uses-permission'] = (m['uses-permission'] || []).filter((p) => !NAMES.includes(p.$['android:name']));
    for (const name of NAMES) {
      m['uses-permission'].push({ $: { 'android:name': name, 'android:maxSdkVersion': '30', 'tools:replace': 'android:maxSdkVersion' } });
    }
    return c;
  });
};
