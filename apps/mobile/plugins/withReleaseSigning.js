/**
 * Android release signing for builds outside EAS (GitHub Actions, docs/build-github.md).
 * If the upload keystore is provided (gradle properties or env DAFTARAK_UPLOAD_*), release builds are signed with it;
 * otherwise they fall back to the debug key (installable test APK — never for the Play Store).
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const BLOCK = `
        release {
            def f = findProperty('DAFTARAK_UPLOAD_STORE_FILE') ?: System.getenv('DAFTARAK_UPLOAD_STORE_FILE')
            if (f) {
                storeFile file(f)
                storePassword findProperty('DAFTARAK_UPLOAD_STORE_PASSWORD') ?: System.getenv('DAFTARAK_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('DAFTARAK_UPLOAD_KEY_ALIAS') ?: System.getenv('DAFTARAK_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('DAFTARAK_UPLOAD_KEY_PASSWORD') ?: System.getenv('DAFTARAK_UPLOAD_KEY_PASSWORD')
            }
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (c) => {
    let g = c.modResults.contents;
    if (g.includes('DAFTARAK_UPLOAD_STORE_FILE')) return c;
    // 1) add a release signing config next to the debug one
    g = g.replace(/signingConfigs\s*\{/, (m) => `${m}${BLOCK}`);
    // 2) release build type uses it when a keystore was given
    g = g.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig signingConfigs.release.storeFile ? signingConfigs.release : signingConfigs.debug`,
    );
    c.modResults.contents = g;
    return c;
  });
};
