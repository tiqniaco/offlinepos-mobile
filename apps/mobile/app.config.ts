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
      NSBluetoothAlwaysUsageDescription: 'للطباعة على طابعة الفواتير بالبلوتوث',
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: 'app.daftarak',
    adaptiveIcon: {
      backgroundColor: '#0F4CC7',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // Data stays on the phone and in our own encrypted backups (Phase 6), never in Google auto-backup.
    allowBackup: false,
    permissions: ['CAMERA', 'BLUETOOTH', 'BLUETOOTH_ADMIN', 'BLUETOOTH_CONNECT', 'BLUETOOTH_SCAN', 'ACCESS_FINE_LOCATION'],
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
    ['react-native-ble-plx', { isBackgroundEnabled: false, modes: [], bluetoothAlwaysPermission: 'للطباعة على طابعة الفواتير بالبلوتوث', neverForLocation: true }],
    ['expo-notifications', { color: '#0F4CC7' }],
    'expo-audio',
    // AdMob (free plan only, PLAN.md §18). Google's public TEST app ids unless real ids are provided at build time.
    [
      'react-native-google-mobile-ads',
      {
        androidAppId: process.env.ADMOB_ANDROID_APP_ID ?? 'ca-app-pub-3940256099942544~3347511713',
        iosAppId: process.env.ADMOB_IOS_APP_ID ?? 'ca-app-pub-3940256099942544~1458002511',
        delayAppMeasurementInit: true,
        userTrackingUsageDescription: 'بنستخدمه عشان الإعلانات في الباقة المجانية تكون مناسبة ليك. تقدر ترفض وهيظهر إعلانات عامة.',
      },
    ],
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#0F4CC7' }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8787',
    // Store billing (RevenueCat public SDK keys; empty → in-app purchase hidden, activation codes still work).
    revenuecat: { android: process.env.REVENUECAT_ANDROID_KEY ?? '', ios: process.env.REVENUECAT_IOS_KEY ?? '' },
    supportWhatsApp: process.env.SUPPORT_WHATSAPP ?? '',
    // Real ad unit ids are injected at release build time; empty → Google test units.
    admob: {
      bannerAndroid: process.env.ADMOB_BANNER_ANDROID ?? '',
      bannerIos: process.env.ADMOB_BANNER_IOS ?? '',
      interstitialAndroid: process.env.ADMOB_INTERSTITIAL_ANDROID ?? '',
      interstitialIos: process.env.ADMOB_INTERSTITIAL_IOS ?? '',
    },
  },
};

export default config;
