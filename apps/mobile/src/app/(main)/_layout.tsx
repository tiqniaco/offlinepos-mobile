import { View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PressableScale } from '../../ui/PressableScale';
import { QuickSheet } from '../../features/quick/QuickSheet';
import { useQuick } from '../../state/quick';
import { fonts } from '../../ui/fonts';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, colors, type IconName } from '../../ui';
import { haptic } from '../../ui/haptics';
import { CrashScreen } from '../../features/errors/CrashScreen';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View style={{ width: 50, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.primary[50] : 'transparent' }}>
      <Icon name={name} size={21} color={focused ? colors.primary[700] : colors.ink.mute} />
    </View>
  );
}

/** Raised round «+» in the middle of the tab bar: opens the quick-actions sheet. */
function PlusButton() {
  const show = useQuick((s) => s.show);
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <PressableScale
        testID="tab-plus"
        accessibilityRole="button"
        feedback="tap"
        scaleTo={0.9}
        onPress={show}
        style={{ marginTop: -22, width: 58, height: 58, borderRadius: 29, shadowColor: colors.primary[700], shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 10 }}
      >
        <LinearGradient
          colors={[colors.grad[0], colors.grad[2]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.paper.card }}
        >
          <Icon name="plus" size={26} color="#FFFFFF" />
        </LinearGradient>
      </PressableScale>
    </View>
  );
}

export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return <CrashScreen error={error} retry={retry} where="main" />;
}

export default function MainLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <>
    <Tabs
      screenListeners={{ tabPress: () => haptic.select() }}
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        tabBarActiveTintColor: colors.primary[700],
        tabBarInactiveTintColor: colors.ink.mute,
        tabBarStyle: {
          backgroundColor: colors.paper.card,
          borderTopWidth: 0,
          height: 62 + insets.bottom,
          paddingTop: 6,
          paddingBottom: insets.bottom + 8,
          shadowColor: '#3A2E1A',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        tabBarAllowFontScaling: false,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 17, marginTop: 1 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} /> }} />
      <Tabs.Screen name="products" options={{ title: t('tabs.products'), tabBarIcon: ({ focused }) => <TabIcon name="box" focused={focused} /> }} />
      <Tabs.Screen name="new" options={{ title: '', tabBarButton: () => <PlusButton /> }} listeners={{ tabPress: (e) => e.preventDefault() }} />
      <Tabs.Screen name="parties" options={{ title: t('tabs.parties'), tabBarIcon: ({ focused }) => <TabIcon name="users" focused={focused} /> }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more'), tabBarIcon: ({ focused }) => <TabIcon name="more" focused={focused} /> }} />
      {/* Sale is opened from «+», the home button and search; it stays a tab route (keeps the cart while switching). */}
      <Tabs.Screen name="sell" options={{ href: null, title: t('tabs.sell') }} />
    </Tabs>
      <QuickSheet />
    </>
  );
}
