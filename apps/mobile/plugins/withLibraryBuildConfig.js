/**
 * Some older native libraries still import their own BuildConfig, which recent Android Gradle Plugin versions no
 * longer generate by default (react-native-bluetooth-classic → "cannot find symbol BuildConfig").
 * Turn buildConfig back on for those library modules only.
 */
const { withProjectBuildGradle } = require('expo/config-plugins');

const LIBS = ['react-native-bluetooth-classic'];
const MARK = '// daftarak: library BuildConfig';

module.exports = function withLibraryBuildConfig(config) {
  return withProjectBuildGradle(config, (c) => {
    if (c.modResults.contents.includes(MARK)) return c;
    c.modResults.contents += `
${MARK}
subprojects { p ->
  if (${JSON.stringify(LIBS)}.contains(p.name)) {
    p.plugins.withId('com.android.library') {
      p.android.buildFeatures.buildConfig = true
    }
  }
}
`;
    return c;
  });
};
