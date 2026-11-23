/**
 * Forced update: full screen, cannot be dismissed. Optional update: a sheet with «حدّث» / «بعدين».
 * Mounted at the root so it also covers the lock screen and onboarding.
 */
import { Modal, View } from 'react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, Sheet, Logo, colors, fonts } from '../../ui';
import Constants from 'expo-constants';
import { allowUnknownSourcesAndInstall, installUpdate, isStoreBuild, useUpdate, watchForUpdates } from './update';
import { openWhatsApp } from '../export/whatsapp';

function Progress({ value }: { value: number }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(value * 100)}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary[600] }} />
    </View>
  );
}

export function UpdateGate() {
  const { t } = useTranslation();
  const { latest, forced, forceAt, unknownSources, snoozed, progress, error, set } = useUpdate();
  useEffect(() => watchForUpdates(), []);
  if (!latest) return null;
  // Android "install unknown apps" explainer (once), before the system installer.
  if (unknownSources) {
    return (
      <Sheet
        visible
        onClose={() => set({ unknownSources: null })}
        title={t('update.unknownTitle')}
        footer={
          <View style={{ gap: 8 }}>
            <Button testID="update-allow-unknown" icon="shield" title={t('update.unknownOpen')} onPress={() => void allowUnknownSourcesAndInstall()} />
            <Button kind="ghost" compact title={t('update.unknownAlready')} onPress={() => { set({ unknownSources: null }); void installUpdate(unknownSources, true); }} />
          </View>
        }
      >
        <Text variant="body">{t('update.unknownBody')}</Text>
      </Sheet>
    );
  }
  const deadline = forceAt ? new Date(forceAt).toLocaleString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }) : null;
  const support = (Constants.expoConfig?.extra as { supportWhatsApp?: string } | undefined)?.supportWhatsApp ?? '';

  const body = (
    <View style={{ gap: 12 }}>
      {latest.notesAr ? <Text variant="body">{latest.notesAr}</Text> : null}
      {!forced && deadline ? <Text style={{ color: colors.amber[700], fontFamily: fonts.bold, fontSize: 13.5 }}>{t('update.forcedSoon', { date: deadline })}</Text> : null}
      {progress != null ? (
        <View style={{ gap: 6 }}>
          <Progress value={progress} />
          <Text variant="caption">{t('update.downloading', { p: Math.round(progress * 100) })}</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: colors.rose[700], fontSize: 13 }}>{t(error === 'checksum' ? 'update.checksum' : 'update.failed')}</Text> : null}
    </View>
  );

  if (forced) {
    return (
      <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => undefined}>
        <View style={{ flex: 1, backgroundColor: colors.paper.DEFAULT, padding: 24, justifyContent: 'center', gap: 18 }}>
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Logo size={84} />
            <Text style={{ fontFamily: fonts.bold, fontSize: 21, textAlign: 'center' }}>{t('update.forcedTitle')}</Text>
            <Text variant="body" style={{ textAlign: 'center' }}>
              {t('update.forcedBody', { v: latest.name })}
            </Text>
          </View>
          {body}
          {latest.url ? (
            <Button testID="update-now" icon="download" title={t('update.now')} loading={progress != null && progress < 1} onPress={() => void installUpdate(latest)} />
          ) : (
            // No download link (e.g. store build): tell the user how to get the new version instead of a dead button.
            <>
              <Text variant="body" style={{ textAlign: 'center' }}>
                {t('update.noUrl')}
              </Text>
              {support ? <Button kind="secondary" icon="whatsapp" title={t('update.contactSupport')} onPress={() => void openWhatsApp(support, t('update.supportMessage', { v: latest.name }))} /> : null}
            </>
          )}
          <Text variant="caption" style={{ textAlign: 'center' }}>
            {t('update.safe')}
          </Text>
        </View>
      </Modal>
    );
  }

  return (
    <Sheet
      visible={snoozed !== latest.code}
      onClose={() => set({ snoozed: latest.code })}
      title={t('update.title', { v: latest.name })}
      footer={
        <View style={{ gap: 8 }}>
          <Button testID="update-now" icon="download" title={isStoreBuild() ? t('update.openStore') : t('update.now')} loading={progress != null && progress < 1} onPress={() => void installUpdate(latest)} />
          <Button kind="ghost" compact title={t('update.later')} onPress={() => set({ snoozed: latest.code })} />
        </View>
      }
    >
      {body}
      <Text variant="caption">{t('update.safe')}</Text>
    </Sheet>
  );
}
