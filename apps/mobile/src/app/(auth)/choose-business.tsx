import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, Card, Banner, Icon } from '../../ui';
import { useOnboarding } from '../../state/app';

export default function ChooseBusiness() {
  const { t } = useTranslation();
  const auth = useOnboarding((s) => s.auth);
  const set = useOnboarding((s) => s.set);
  if (!auth) return null;
  return (
    <Screen title={t('chooseBusiness.title')}>
      <Text>{t('chooseBusiness.body')}</Text>
      <Banner tone="warn" text={t('chooseBusiness.existingWarning')} />
      {auth.businesses.map((b) => (
        <Card
          key={b.id}
          onPress={() => {
            set({ existingBusinessId: b.id, businessForm: { name: b.name, country: b.country, type: b.type, vatRegistered: false, vatNumber: null } });
            router.push('/owner');
          }}
        >
          <View className="flex-row items-center gap-3">
            <Icon name="store" />
            <Text variant="subtitle" className="flex-1">
              {t('chooseBusiness.useExisting', { name: b.name })}
            </Text>
            <Icon name="chevron" />
          </View>
        </Card>
      ))}
      <Button
        kind="secondary"
        icon="plus"
        title={t('chooseBusiness.createNew')}
        onPress={() => {
          set({ existingBusinessId: null });
          router.push('/business');
        }}
      />
    </Screen>
  );
}
