import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Sheet, Text, Button, IconBadge } from '../ui';
import { useUpgrade } from '../state/upgrade';
import { View } from 'react-native';

/** Friendly upgrade sheet — nothing is deleted or hidden; only NEW records above the limit wait for a plan. */
export function UpgradeSheet() {
  const { t } = useTranslation();
  const reason = useUpgrade((s) => s.reason);
  const hide = useUpgrade((s) => s.hide);
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
        <IconBadge name="card" hue="primary" size={56} />
        <Text variant="title" style={{ textAlign: 'center' }}>{t(reason === 'feature' ? 'upgrade.featureTitle' : 'upgrade.limitTitle')}</Text>
        <Text variant="body" style={{ textAlign: 'center' }}>{t(reason === 'feature' ? 'upgrade.featureBody' : 'upgrade.limitBody', { what: t(`upgrade.what.${reason ?? 'x'}`, { defaultValue: '' }) })}</Text>
      </View>
    </Sheet>
  );
}
