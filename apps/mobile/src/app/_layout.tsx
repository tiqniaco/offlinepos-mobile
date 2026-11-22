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
import { ToastHost } from '../ui/Toast';
import { AdsProvider } from '../features/ads/AdsProvider';
import { modalOptions, stackOptions } from '../ui/motion';
import { PrintHost } from '../features/printing/PrintHost';
import { colors, useTheme, applyTheme } from '../ui';

void SplashScreen.preventAutoHideAsync();

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

  useEffect(() => {
    void boot();
  }, []);

  // boot() loads the chosen font family before leaving 'booting'.
  const ready = status !== 'booting';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
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
          </Stack.Protected>
        </Stack>
        <ToastHost />
        {status === 'ready' ? (
          <>
            <PrintHost />
            <AdsProvider />
          </>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}
