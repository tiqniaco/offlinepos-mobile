import '../lib/polyfills';
import '../../global.css';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { useApp } from '../state/app';
import { boot } from '../state/boot';
import { useAutoLock } from '../hooks/useAutoLock';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ IBMPlexSansArabic_400Regular, IBMPlexSansArabic_500Medium, IBMPlexSansArabic_600SemiBold, IBMPlexSansArabic_700Bold });
  const status = useApp((s) => s.status);
  const touch = useApp((s) => s.touch);
  useAutoLock();

  useEffect(() => {
    void boot();
  }, []);

  const ready = fontsLoaded && status !== 'booting';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/* Any touch counts as activity for the auto-lock timer. */}
      <View className="flex-1 bg-paper" onTouchStart={touch}>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F6F2EA' }, animation: 'fade' }}>
          <Stack.Protected guard={__DEV__ && Platform.OS === 'web'}>
            <Stack.Screen name="dev-gallery" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'fatal'}>
            <Stack.Screen name="fatal" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'onboarding'}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'locked'}>
            <Stack.Screen name="lock" />
          </Stack.Protected>
          <Stack.Protected guard={status === 'ready'}>
            <Stack.Screen name="(main)" />
            <Stack.Screen name="settings" />
          </Stack.Protected>
        </Stack>
      </View>
    </SafeAreaProvider>
  );
}
