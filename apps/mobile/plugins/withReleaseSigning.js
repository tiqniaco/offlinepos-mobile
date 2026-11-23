/**
 * Android release signing for builds outside EAS (GitHub Actions, docs/build-github.md).
 * Release builds MUST be signed with the upload keystore (gradle properties or env DAFTARAK_UPLOAD_*). Without it a
 * release task fails — a debug-signed release could otherwise reach users (and a debug key is public: anyone could
 * ship an "update" over it). The only exception is E2E=1 (emulator screen tours / Maestro), which uses the debug key.
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

// Runs when the task graph is known, so debug builds and IDE syncs are not affected.
const GUARD = `

// Added by plugins/withReleaseSigning.js: never ship a release signed with the debug key.
gradle.taskGraph.whenReady { graph ->
    def releaseTask = graph.allTasks.find { t ->
        t.project == project && t.name =~ /^(assemble|bundle|package|sign).*Release/
    }
    if (releaseTask && !android.signingConfigs.release.storeFile && System.getenv('E2E') != '1') {
        throw new GradleException("Release build without the upload keystore (DAFTARAK_UPLOAD_STORE_FILE). " +
            "Set the ANDROID_KEYSTORE_* secrets / DAFTARAK_UPLOAD_* properties, or E2E=1 for an emulator test build.")
    }
}
`;

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
    // 3) …and the debug fallback is only allowed for E2E builds
    g += GUARD;
    c.modResults.contents = g;
    return c;
  });
};
