import type { ExpoConfig } from 'expo/config';

// Build-time configuration. API URL comes from the environment so dev/staging/prod builds differ
// only by env (see docs/dev-setup.md). Nothing secret belongs here — it ships inside the app.
const config: ExpoConfig = {
  name: 'دفترك',
  slug: 'daftarak',
  scheme: 'daftarak',
  version: '0.1.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'app.daftarak',
    supportsTablet: true,
    infoPlist: {
      NSFaceIDUsageDescription: 'لفتح دفترك بالبصمة بدل الرقم السري',
      NSCameraUsageDescription: 'لقراءة الباركود وتصوير المنتجات',
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: 'app.daftarak',
    adaptiveIcon: {
      backgroundColor: '#0E8C80',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Data stays on the phone and in our own encrypted backups (Phase 6), never in Google auto-backup.
    allowBackup: false,
    permissions: ['CAMERA'],
  },
  plugins: [
    'expo-router',
    ['expo-sqlite', { useSQLCipher: true, enableFTS: true }],
    'expo-secure-store',
    ['expo-localization', { supportedLocales: { ios: ['ar', 'en'], android: ['ar', 'en'] } }],
    'expo-font',
    ['expo-local-authentication', { faceIDPermission: 'لفتح دفترك بالبصمة بدل الرقم السري' }],
    ['expo-image-picker', { cameraPermission: 'لقراءة الباركود وتصوير المنتجات', photosPermission: 'لاختيار صورة المنتج' }],
    'expo-document-picker',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#0E8C80' }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8787',
  },
};

export default config;
