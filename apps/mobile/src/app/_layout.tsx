import '../lib/polyfills';
import '../../global.css';
import { useEffect } from 'react';
import { Platform, View, useColorScheme } from 'react-native';
import { vars } from 'nativewind';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useApp } from '../state/app';
import { boot } from '../state/boot';
import { useAutoLock } from '../hooks/useAutoLock';
import { watchPrivacy } from '../state/privacy';
import { ToastHost } from '../ui/Toast';
import { AdsProvider } from '../features/ads/AdsProvider';
import { UpgradeSheet } from '../features/UpgradeSheet';
import { markInteractive } from '../state/boot';
import { onNotificationTap } from '../features/notify/notify';
import { modalOptions, stackOptions } from '../ui/motion';
import { PrintHost } from '../features/printing/PrintHost';
import { colors, useTheme, applyTheme } from '../ui';

import { CrashScreen, persistClientError, reportClientError } from '../features/errors/CrashScreen';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { UpdateGate } from '../features/update/UpdateGate';
import { AppSwitcherCover } from '../features/privacy/AppSwitcherCover';

void SplashScreen.preventAutoHideAsync();

// Errors outside rendering (promises, handlers) are reported too.
const g = globalThis as unknown as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
if (g.ErrorUtils) {
  const prev = g.ErrorUtils.getGlobalHandler();
  g.ErrorUtils.setGlobalHandler((e, fatal) => {
    if (fatal) persistClientError(e, 'fatal'); // the app may die before the request leaves: sent on next launch
    reportClientError(e, fatal ? 'fatal' : 'global');
    prev(e, fatal);
  });
}

/** Any render error anywhere: show it (with retry) instead of a black screen, and report it. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <CrashScreen error={error} retry={retry} where="root" />;
}

export default function RootLayout() {
  const status = useApp((s) => s.status);
  const touch = useApp((s) => s.touch);
  const theme = useTheme();
  const scheme = useColorScheme();
  useAutoLock();

  const pathname = usePathname();
  // After a theme change the tree remounts: reopen the screen the user was on (the appearance screen).
  useEffect(() => {
    const back = useTheme.getState().returnTo;
    if (!back) return;
    useTheme.setState({ returnTo: null });
    if (pathname !== back) setTimeout(() => router.push(back as never), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme.version]);

  // 'system' appearance follows the phone's dark/light setting live.
  useEffect(() => {
    if (theme.appearance === 'system') applyTheme(theme.palette, 'system', scheme === 'dark');
  }, [scheme, theme.appearance, theme.palette]);

  // «إخفاء الأرقام الحساسة»: revealed numbers hide again after > 1 min in the background.
  useEffect(() => watchPrivacy(), []);

  useEffect(() => {
    void boot();
    return onNotificationTap((url) => router.push(url as never));
  }, []);

  // boot() loads the chosen font family before leaving 'booting'.
  const ready = status !== 'booting';
  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
      markInteractive();
    }
  }, [ready]);
  if (!ready) return null;

  return (
    <KeyboardProvider>
    <SafeAreaProvider>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      {/* Theme colours as CSS variables for NativeWind; `key` repaints every screen when the theme changes.
          Any touch counts as activity for the auto-lock timer. */}
      <View key={theme.version} style={[{ flex: 1, backgroundColor: colors.paper.DEFAULT }, vars(theme.vars)]} onTouchStart={touch}>
        <Stack screenOptions={stackOptions()}>
          <Stack.Protected guard={__DEV__ && Platform.OS === 'web'}>
            <Stack.Screen name="dev-gallery" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'fatal'}>
            <Stack.Screen name="fatal" options={{ animation: 'fade', gestureEnabled: false }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'onboarding'}>
            <Stack.Screen name="(auth)" options={{ animation: 'fade', gestureEnabled: false }} />
          </Stack.Protected>
          <Stack.Protected guard={status === 'locked'}>
            <Stack.Screen name="lock" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="unlock-reset" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'ready'}>
            <Stack.Screen name="(main)" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="settings" />
            <Stack.Screen name="products" />
            <Stack.Screen name="sales" />
            <Stack.Screen name="parties" />
            <Stack.Screen name="purchases" />
            <Stack.Screen name="vouchers" />
            <Stack.Screen name="expenses" />
            <Stack.Screen name="shifts" />
            <Stack.Screen name="offers" />
            <Stack.Screen name="reports" />
            <Stack.Screen name="scan" options={modalOptions} />
            <Stack.Screen name="search" options={{ presentation: 'modal', animation: 'fade_from_bottom' }} />
          </Stack.Protected>
        </Stack>
        <ToastHost />
        <UpdateGate />
        {status === 'ready' ? (
          <>
            <PrintHost />
            <AdsProvider />
            <UpgradeSheet />
          </>
        ) : null}
        <AppSwitcherCover />
      </View>
    </SafeAreaProvider>
    </KeyboardProvider>
  );
}
