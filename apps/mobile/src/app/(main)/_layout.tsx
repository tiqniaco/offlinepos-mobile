import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, colors, type IconName } from '../../ui';

function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View style={{ width: 56, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? colors.teal[50] : 'transparent' }}>
      <Icon name={name} color={focused ? colors.teal[700] : colors.ink.mute} />
    </View>
  );
}

export default function MainLayout() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal[700],
        tabBarInactiveTintColor: colors.ink.mute,
        tabBarStyle: {
          backgroundColor: colors.paper.card,
          borderTopWidth: 0,
          height: 68 + insets.bottom,
          paddingTop: 8,
          paddingBottom: insets.bottom + 8,
          shadowColor: '#3A2E1A',
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 12,
        },
        tabBarLabelStyle: { fontFamily: 'IBMPlexSansArabic_600SemiBold', fontSize: 12, marginTop: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} /> }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more'), tabBarIcon: ({ focused }) => <TabIcon name="more" focused={focused} /> }} />
    </Tabs>
  );
}
