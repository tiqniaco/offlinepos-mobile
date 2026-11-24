import { View } from 'react-native';
import { fonts } from '../../ui/fonts';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OnboardingScreen, Text, Button, Card, Banner, IconBadge, Icon, colors } from '../../ui';
import { useOnboarding } from '../../state/app';
import { Pressable } from '../../ui/Press';

export default function ChooseBusiness() {
  const { t } = useTranslation();
  const auth = useOnboarding((s) => s.auth);
  const set = useOnboarding((s) => s.set);
  if (!auth) return null;
  return (
    <OnboardingScreen step={3} stepLabel={t('onboarding.step', { n: 3, total: 4 })} title={t('chooseBusiness.title')} subtitle={t('chooseBusiness.body')}>
      {auth.businesses.map((b) => (
        <Card
          key={b.id}
          onPress={() => {
            set({ existingBusinessId: b.id, businessForm: { name: b.name, country: b.country, type: b.type, vatRegistered: false, vatNumber: null } });
            router.push('/restore');
          }}
        >
          <View className="flex-row items-center gap-3">
            <IconBadge name="store" hue="amber" />
            <View className="flex-1">
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{b.name}</Text>
              <Text variant="caption">{t('chooseBusiness.useExisting', { name: b.name })}</Text>
            </View>
            <Icon name="chevron" color={colors.ink.faint} />
          </View>
          <Pressable
            testID={`follow-${b.id}`}
            onPress={() => {
              set({ existingBusinessId: b.id });
              router.push('/follow-shop');
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.paper.line }}
          >
            <Icon name="eye" size={18} color={colors.primary[600]} />
            <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 22, color: colors.primary[700] }}>{t('follow.chooseFollow')}</Text>
          </Pressable>
        </Card>
      ))}
      <Banner tone="warn" text={t('chooseBusiness.existingWarning')} />
      <Button
        kind="secondary"
        icon="plus"
        title={t('chooseBusiness.createNew')}
        onPress={() => {
          set({ existingBusinessId: null });
          router.push('/business');
        }}
      />
    </OnboardingScreen>
  );
}
