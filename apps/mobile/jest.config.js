module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
  // *.db.test.ts are SQLite integration tests run by Vitest (vitest.db.config.ts).
  testPathIgnorePatterns: ['\\.db\\.test\\.ts$', '/node_modules/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Local native module (Android SMS User Consent) has no JS implementation to run under Jest.
    '(^|/)modules/sms-consent$': '<rootDir>/src/test/smsConsentMock.ts',
    '(^|/)modules/drive-share$': '<rootDir>/src/test/driveShareMock.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@noble/.*|@daftarak/.*|nativewind|react-native-css-interop)',
  ],
};
