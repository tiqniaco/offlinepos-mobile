/** E2E builds only (E2E=1): allow http:// to the local Worker on the emulator host (10.0.2.2). Never in store builds. */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withE2ECleartext(config) {
  if (process.env.E2E !== '1') return config;
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return c;
  });
};
