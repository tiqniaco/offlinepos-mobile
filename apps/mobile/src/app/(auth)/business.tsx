import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { COUNTRY_PROFILES, countryOfPhone, digitsOnly } from '@daftarak/shared';
import { OnboardingScreen, Text, Button, TextField, Choice, SectionTitle, Card } from '../../ui';
import { useOnboarding } from '../../state/app';

/** Business name → country → type → VAT. Country defaults from the phone prefix. */
export default function BusinessScreen() {
  const { t } = useTranslation();
  const phone = useOnboarding((s) => s.phone);
  const [name, setName] = useState('');
  const [country, setCountry] = useState<'EG' | 'SA'>(countryOfPhone(phone) ?? 'EG');
  const [type, setType] = useState<'shop' | 'trading'>('shop');
  const [vat, setVat] = useState(false);
  const [vatNumber, setVatNumber] = useState('');
  const [errors, setErrors] = useState<{ name?: string; vat?: string }>({});

  const next = () => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = t('errors.required');
    if (vat && vatNumber.trim().length < 5) e.vat = t('errors.required');
    setErrors(e);
    if (Object.keys(e).length) return;
    useOnboarding.getState().set({ businessForm: { name: name.trim(), country, type, vatRegistered: vat, vatNumber: vat ? vatNumber.trim() : null } });
    router.push('/owner');
  };

  const rate = COUNTRY_PROFILES[country].vatRateBp / 100;
  return (
    <OnboardingScreen
      step={3}
      stepLabel={t('onboarding.step', { n: 3, total: 4 })}
      title={t('business.title')}
      footer={<Button testID="business-next" title={t('common.next')} icon="chevron" onPress={next} />}
    >
      <TextField testID="business-name" icon="store" label={t('business.name')} placeholder={t('business.namePlaceholder')} value={name} onChangeText={setName} error={errors.name} latinDigits={false} />

      <SectionTitle>{t('business.country')}</SectionTitle>
      <View className="flex-row gap-3">
        <Choice compact testID="country-EG" emoji="🇪🇬" title={t('business.EG')} selected={country === 'EG'} onPress={() => setCountry('EG')} />
        <Choice compact testID="country-SA" emoji="🇸🇦" title={t('business.SA')} selected={country === 'SA'} onPress={() => setCountry('SA')} />
      </View>

      <SectionTitle>{t('business.type')}</SectionTitle>
      <View className="gap-3">
        <Choice testID="type-shop" icon="store" hue="amber" title={t('business.shop')} hint={t('business.shopHint')} selected={type === 'shop'} onPress={() => setType('shop')} />
        <Choice testID="type-trading" icon="truck" hue="sky" title={t('business.trading')} hint={t('business.tradingHint')} selected={type === 'trading'} onPress={() => setType('trading')} />
      </View>

      <SectionTitle>{t('business.vat')}</SectionTitle>
      <Card>
        <View className="gap-3">
          <View className="flex-row gap-3">
            <Choice compact testID="vat-no" title={t('common.no')} selected={!vat} onPress={() => setVat(false)} />
            <Choice compact testID="vat-yes" title={t('common.yes')} hint={t('business.vatRate', { rate })} selected={vat} onPress={() => setVat(true)} />
          </View>
          {vat ? (
            <TextField label={t('business.vatNumber')} value={vatNumber} onChangeText={(v) => setVatNumber(digitsOnly(v))} keyboardType="number-pad" ltr error={errors.vat} />
          ) : (
            <Text variant="caption">{t('business.vatHint')}</Text>
          )}
        </View>
      </Card>
    </OnboardingScreen>
  );
}
