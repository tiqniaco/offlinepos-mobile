import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Icon, colors } from '../ui';
import { useApp } from '../state/app';

export default function Fatal() {
  const { t } = useTranslation();
  const fatal = useApp((s) => s.fatal);
  return (
    <Screen>
      <View className="mt-24 items-center gap-4">
        <Icon name="shield" size={56} color={colors.rose[500]} />
        <Text variant="title" className="text-center">
          {t('app.name')}
        </Text>
        <Text className="text-center">{fatal === 'db_not_encrypted' ? t('errors.dbNotEncrypted') : t('errors.unknown')}</Text>
      </View>
    </Screen>
  );
}
