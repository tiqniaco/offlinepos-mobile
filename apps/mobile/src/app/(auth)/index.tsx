import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, Button, Hero, Logo, IconBadge, Card, colors, type IconName, type Hue } from '../../ui';

const POINTS: { icon: IconName; hue: Hue; key: string; hint: string }[] = [
  { icon: 'cloudOff', hue: 'primary', key: 'welcome.point1', hint: 'welcome.point1Hint' },
  { icon: 'book', hue: 'amber', key: 'welcome.point2', hint: 'welcome.point2Hint' },
  { icon: 'shield', hue: 'sky', key: 'welcome.point3', hint: 'welcome.point3Hint' },
];

export default function Welcome() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-paper">
      <Hero>
        <View className="items-center gap-4 px-6 pb-10 pt-10">
          <View style={{ backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 34, padding: 10 }}>
            <Logo size={92} />
          </View>
          <View className="items-center gap-1">
            <Text style={{ color: '#FFFFFF', fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 38, lineHeight: 52 }}>{t('app.name')}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 16, lineHeight: 26, textAlign: 'center', fontFamily: 'IBMPlexSansArabic_500Medium' }}>{t('app.tagline')}</Text>
          </View>
          <View style={{ backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 99, paddingHorizontal: 14, paddingVertical: 6 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 13, lineHeight: 20, fontFamily: 'IBMPlexSansArabic_600SemiBold' }}>{t('welcome.badge')}</Text>
          </View>
        </View>
      </Hero>
      <View className="flex-1 justify-between px-5" style={{ marginTop: -18, paddingBottom: Math.max(insets.bottom, 16) }}>
        <Card padded={false}>
          {POINTS.map((p, i) => (
            <View key={p.key} className="flex-row items-center gap-3 px-4 py-3.5" style={i < POINTS.length - 1 ? { borderBottomWidth: 1, borderBottomColor: colors.paper.line + '99' } : null}>
              <IconBadge name={p.icon} hue={p.hue} size={46} />
              <View className="flex-1">
                <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{t(p.key)}</Text>
                <Text variant="caption">{t(p.hint)}</Text>
              </View>
            </View>
          ))}
        </Card>
        <View className="gap-3 pt-5">
          <Button testID="welcome-start" title={t('welcome.start')} icon="chevron" onPress={() => router.push('/phone')} />
          <Text variant="caption" className="text-center">
            {t('welcome.free')}
          </Text>
        </View>
      </View>
    </View>
  );
}
