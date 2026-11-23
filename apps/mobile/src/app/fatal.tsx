import { useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Icon, Button, colors } from '../ui';
import { useApp } from '../state/app';
import { boot } from '../state/boot';
import { toast } from '../state/toast';
import { moveDatabaseAside } from '../db/client';
import { clientErrorPayload, sendClientError } from '../features/errors/CrashScreen';

/**
 * Start-up failed (database unreadable, or any other boot error). Never a dead end: retry, send the details to
 * support, start over from a backup (the unreadable file is set aside, never deleted), or ask on WhatsApp.
 */
export default function Fatal() {
  const { t } = useTranslation();
  const fatal = useApp((s) => s.fatal);
  const detail = useApp((s) => s.fatalDetail);
  const [busy, setBusy] = useState<'retry' | 'send' | 'restore' | null>(null);
  const support = ((Constants.expoConfig?.extra as { supportWhatsApp?: string } | undefined)?.supportWhatsApp ?? '').replace(/\D/g, '');
  const encrypted = fatal === 'db_not_encrypted';

  const retry = async () => {
    setBusy('retry');
    try {
      await boot();
    } finally {
      setBusy(null);
    }
  };
  const send = async () => {
    setBusy('send');
    const ok = await sendClientError(clientErrorPayload(new Error(detail ?? fatal ?? 'fatal'), `fatal-screen:${fatal ?? '?'}`));
    setBusy(null);
    toast(ok ? t('fatal.sent') : t('fatal.sendFailed'), ok ? 'success' : 'error');
  };
  const restore = () =>
    Alert.alert(t('fatal.restoreTitle'), t('fatal.restoreBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('fatal.restoreGo'),
        onPress: () => {
          setBusy('restore');
          try {
            moveDatabaseAside('unreadable');
          } catch {
            setBusy(null);
            toast(t('fatal.restoreFailed'), 'error');
            return;
          }
          // Empty database → onboarding, where both "restore from cloud" (sign in) and "restore from file" live.
          void boot().finally(() => setBusy(null));
        },
      },
    ]);
  const whatsapp = () => {
    const text = encodeURIComponent(`${t('fatal.whatsappText')}\n${fatal ?? ''} ${(detail ?? '').split('\n')[0]}`);
    void Linking.openURL(`https://wa.me/${support}?text=${text}`).catch(() => undefined);
  };

  return (
    <Screen>
      <View className="mt-16 items-center gap-4 px-2">
        <Icon name="shield" size={56} color={colors.rose[500]} />
        <Text variant="title" className="text-center">
          {t('fatal.title')}
        </Text>
        <Text className="text-center">{encrypted ? t('errors.dbNotEncrypted') : fatal === 'db_open_failed' ? t('fatal.dbBody') : t('fatal.body')}</Text>
      </View>
      <View className="mt-8 gap-3">
        <Button icon="refresh" title={t('common.retry')} loading={busy === 'retry'} disabled={!!busy} onPress={() => void retry()} />
        <Button kind="secondary" icon="upload" title={t('fatal.send')} loading={busy === 'send'} disabled={!!busy} onPress={() => void send()} />
        {!encrypted ? <Button kind="secondary" icon="download" title={t('fatal.restore')} loading={busy === 'restore'} disabled={!!busy} onPress={restore} /> : null}
        {support ? <Button kind="ghost" icon="whatsapp" title={t('fatal.whatsapp')} disabled={!!busy} onPress={whatsapp} /> : null}
      </View>
      {detail ? (
        <ScrollView style={{ maxHeight: 140, marginTop: 16, backgroundColor: colors.paper.sunk, borderRadius: 12, padding: 10 }}>
          <Text variant="caption" selectable>
            {detail}
          </Text>
        </ScrollView>
      ) : null}
    </Screen>
  );
}
