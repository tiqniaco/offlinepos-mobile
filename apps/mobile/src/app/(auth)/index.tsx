import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Svg, { Defs, LinearGradient, Stop, Rect, Path } from 'react-native-svg';
import { Screen, Text, Button, Icon, colors, type IconName } from '../../ui';

function Logo() {
  return (
    <Svg width={96} height={96} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#18A999" />
          <Stop offset="1" stopColor="#0B6B63" />
        </LinearGradient>
      </Defs>
      <Rect width="512" height="512" rx="116" fill="url(#bg)" />
      <Path d="M256 176 C214 150 156 146 112 162 L112 366 C156 350 214 354 256 380 Z" fill="#FFFFFF" />
      <Path d="M256 176 C298 150 356 146 400 162 L400 366 C356 350 298 354 256 380 Z" fill="#F7F1E4" />
      <Path d="M290 222 L356 214 M290 258 L372 250 M290 294 L340 288" stroke="#18A999" strokeWidth={12} strokeLinecap="round" />
      <Path d="M150 268 L182 298 L226 236" fill="none" stroke="#F2A93B" strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M362 150 h26 v96 l-13 -13 l-13 13 z" fill="#F2A93B" />
    </Svg>
  );
}

const POINTS: { icon: IconName; key: string }[] = [
  { icon: 'cloudOff', key: 'welcome.point1' },
  { icon: 'book', key: 'welcome.point2' },
  { icon: 'shield', key: 'welcome.point3' },
];

export default function Welcome() {
  const { t } = useTranslation();
  return (
    <Screen footer={<Button testID="welcome-start" title={t('welcome.start')} onPress={() => router.push('/phone')} />}>
      <View className="mt-14 items-center gap-4">
        <Logo />
        <Text variant="display" className="text-center text-teal-800">
          {t('app.name')}
        </Text>
        <Text className="max-w-[300px] text-center">{t('welcome.body')}</Text>
      </View>
      <View className="mt-8 gap-3">
        {POINTS.map((p) => (
          <View key={p.key} className="flex-row items-center gap-3 rounded-card bg-paper-card px-4 py-3">
            <Icon name={p.icon} color={colors.teal[600]} />
            <Text variant="subtitle">{t(p.key)}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}
