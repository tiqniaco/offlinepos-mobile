import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Choice } from '../../ui';
import { getDb } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { useApp } from '../../state/app';
import { ensureDirection, initI18n, type Lang } from '../../i18n';
import { reloadAppData } from '../../state/boot';

export default function Language() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const lang = useApp((s) => s.settings.language ?? 'ar');
  const choose = async (l: Lang) => {
    if (l === lang) return;
    await changeSetting(getDb(), 'language', l, { userId: user.id, deviceId: device.id });
    await reloadAppData();
    initI18n(l);
    await ensureDirection(l);
  };
  return (
    <Screen back title={t('more.language')}>
      <View className="gap-2">
        <Choice emoji="🇪🇬" title="العربية" hint="اتجاه من اليمين للشمال" selected={lang === 'ar'} onPress={() => void choose('ar')} />
        <Choice emoji="🇬🇧" title="English" hint="Left-to-right layout" selected={lang === 'en'} onPress={() => void choose('en')} />
      </View>
      <Text variant="caption">{t('language.restart')}</Text>
    </Screen>
  );
}
