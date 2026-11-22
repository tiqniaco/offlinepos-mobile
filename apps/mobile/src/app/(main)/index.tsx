import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { Screen, Text, Card, Icon, colors } from '../../ui';
import { useApp } from '../../state/app';
import { LicenceBanner } from '../../features/LicenceBanner';

export default function Home() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user);
  const business = useApp((s) => s.business);
  const hour = new Date().getHours();
  return (
    <Screen scroll>
      <View className="mt-3 gap-1">
        <Text variant="caption">{business?.name}</Text>
        <Text variant="title">{t(hour < 15 ? 'home.greeting' : 'home.greetingEvening', { name: user?.name ?? '' })}</Text>
      </View>
      <LicenceBanner />
      <LinearGradient colors={[colors.teal[500], colors.teal[700]]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ borderRadius: 16, padding: 18 }}>
        <View className="flex-row items-center gap-3">
          <Icon name="book" color="#fff" tint="#ffffff33" size={30} />
          <View className="flex-1">
            <Text variant="subtitle" className="text-white">
              {t('home.nextPhaseTitle')}
            </Text>
            <Text variant="caption" className="text-teal-50">
              {t('home.nextPhaseBody')}
            </Text>
          </View>
        </View>
      </LinearGradient>
      <Card>
        <View className="flex-row items-center gap-3">
          <Icon name="shield" color={colors.leaf[500]} />
          <Text variant="label" className="flex-1">
            {t('welcome.point3')}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}
