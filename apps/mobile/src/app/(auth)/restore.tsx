import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OnboardingScreen, Text, Card, IconBadge, Icon, colors, fonts } from '../../ui';

/**
 * New phone, existing shop: the data only comes back from the shop's own ".kashiro" backup file (no server copy).
 * The restored phone is linked to the account afterwards from the app (settings → link this phone).
 */
export default function Restore() {
  const { t } = useTranslation();
  const option = (testID: string, icon: 'download' | 'plus', hue: 'leaf' | 'primary', title: string, hint: string, go: () => void) => (
    <Card testID={testID} onPress={go}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconBadge name={icon} hue={hue} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{title}</Text>
          <Text variant="caption">{hint}</Text>
        </View>
        <Icon name="chevron" color={colors.ink.faint} />
      </View>
    </Card>
  );
  return (
    <OnboardingScreen title={t('restore.title')} subtitle={t('restore.subtitle')}>
      {option('restore-file', 'download', 'leaf', t('restore.fromFile'), t('restore.fromFileHint'), () => router.push('/restore-file'))}
      {option('restore-empty', 'plus', 'primary', t('restore.startEmpty'), t('restore.emptyHint'), () => router.push('/owner'))}
    </OnboardingScreen>
  );
}
