import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, colors } from '../../ui';

export default function MainLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.teal[700],
        tabBarInactiveTintColor: colors.ink.mute,
        tabBarStyle: { backgroundColor: colors.paper.card, borderTopColor: colors.paper.line, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarLabelStyle: { fontFamily: 'IBMPlexSansArabic_500Medium', fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabs.home'), tabBarIcon: ({ color }) => <Icon name="home" color={color as string} /> }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more'), tabBarIcon: ({ color }) => <Icon name="more" color={color as string} /> }} />
    </Tabs>
  );
}
