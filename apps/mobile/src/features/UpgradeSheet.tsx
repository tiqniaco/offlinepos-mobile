import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Sheet, Text, Button, IconBadge, Icon, colors } from '../ui';
import { useUpgrade } from '../state/upgrade';
import { View } from 'react-native';

/** Friendly upgrade sheet — nothing is deleted or hidden; only NEW records above the limit wait for a plan. */
export function UpgradeSheet() {
  const { t } = useTranslation();
  const reason = useUpgrade((s) => s.reason);
  const hide = useUpgrade((s) => s.hide);
  const promo = reason === 'nudge' || reason === 'trialEnd';
  return (
    <Sheet
      visible={!!reason}
      onClose={hide}
      footer={
        <>
          <Button testID="upgrade-go" icon="card" title={t('upgrade.see')} onPress={() => { hide(); router.push('/settings/subscription'); }} />
          <Button kind="ghost" title={t('upgrade.later')} onPress={hide} />
        </>
      }
    >
      <View style={{ alignItems: 'center', gap: 8 }}>
        <IconBadge name={promo ? 'shield' : 'card'} hue="primary" size={56} />
        <Text variant="title" style={{ textAlign: 'center' }}>
          {t(reason === 'ocr' ? 'upgrade.ocrTitle' : reason === 'ocrQuota' ? 'upgrade.ocrQuotaTitle' : reason === 'trialEnd' ? 'upgrade.trialEndTitle' : reason === 'nudge' ? 'upgrade.nudgeTitle' : reason === 'feature' ? 'upgrade.featureTitle' : 'upgrade.limitTitle')}
        </Text>
        <Text variant="body" style={{ textAlign: 'center' }}>
          {t(reason === 'ocr' ? 'upgrade.ocrBody' : reason === 'ocrQuota' ? 'upgrade.ocrQuotaBody' : reason === 'trialEnd' ? 'upgrade.trialEndBody' : reason === 'nudge' ? 'upgrade.nudgeBody' : reason === 'feature' ? 'upgrade.featureBody' : 'upgrade.limitBody', { what: t(`upgrade.what.${reason ?? 'x'}`, { defaultValue: '' }) })}
        </Text>
      </View>
      {promo ? (
        <View style={{ gap: 7, paddingHorizontal: 4 }}>
          {(['noAds', 'unlimited', 'users', 'reports', 'offers'] as const).map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={16} color={colors.leaf[600]} />
              <Text variant="body" style={{ flex: 1 }}>{t(`upgrade.perk.${k}`)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Sheet>
  );
}
