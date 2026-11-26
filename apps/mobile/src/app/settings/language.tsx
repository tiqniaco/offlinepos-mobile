import { Alert, I18nManager, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Choice } from '../../ui';
import { closeDatabase, getDb, openDatabase } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { useApp } from '../../state/app';
import { ensureDirection, initI18n, type Lang } from '../../i18n';
import { reloadAppData } from '../../state/boot';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';

export default function Language() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const lang = useApp((s) => s.settings.language ?? 'ar');
  const choose = async (l: Lang) => {
    if (l === lang) return;
    try {
      await changeSetting(getDb(), 'language', l, { userId: user.id, deviceId: device.id });
      // Switching between RTL and LTR needs a reload; if the app could not reload itself, ask the user to reopen it.
      const needsReload = I18nManager.isRTL !== (l === 'ar');
      if (!needsReload) {
        await reloadAppData();
        initI18n(l);
        return;
      }
      // Reload straight away (no re-render of every screen in the other direction first), with the database closed.
      const reloaded = await ensureDirection(l, {
        beforeReload: closeDatabase,
        reloadFailed: async () => {
          await openDatabase();
          await reloadAppData();
          initI18n(l);
        },
      });
      if (needsReload && !reloaded) Alert.alert(t('language.reopenTitle'), t('language.reopenBody'), [{ text: t('common.done') }]);
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
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
