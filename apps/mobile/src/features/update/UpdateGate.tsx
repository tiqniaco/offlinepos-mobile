/**
 * Forced update: full screen, cannot be dismissed. Optional update: a sheet with «حدّث» / «بعدين».
 * Mounted at the root so it also covers the lock screen and onboarding.
 */
import { Modal, View } from 'react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text, Sheet, Logo, colors, fonts } from '../../ui';
import { installUpdate, useUpdate, watchForUpdates } from './update';

function Progress({ value }: { value: number }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
      <View style={{ width: `${Math.round(value * 100)}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary[600] }} />
    </View>
  );
}

export function UpdateGate() {
  const { t } = useTranslation();
  const { latest, forced, snoozed, progress, error, set } = useUpdate();
  useEffect(() => watchForUpdates(), []);
  if (!latest) return null;

  const body = (
    <View style={{ gap: 12 }}>
      {latest.notesAr ? <Text variant="body">{latest.notesAr}</Text> : null}
      {progress != null ? (
        <View style={{ gap: 6 }}>
          <Progress value={progress} />
          <Text variant="caption">{t('update.downloading', { p: Math.round(progress * 100) })}</Text>
        </View>
      ) : null}
      {error ? <Text style={{ color: colors.rose[700], fontSize: 13 }}>{t('update.failed')}</Text> : null}
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
          <Button testID="update-now" icon="download" title={t('update.now')} loading={progress != null && progress < 1} onPress={() => void installUpdate(latest)} />
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
          <Button testID="update-now" icon="download" title={t('update.now')} loading={progress != null && progress < 1} onPress={() => void installUpdate(latest)} />
          <Button kind="ghost" compact title={t('update.later')} onPress={() => set({ snoozed: latest.code })} />
        </View>
      }
    >
      {body}
      <Text variant="caption">{t('update.safe')}</Text>
    </Sheet>
  );
}
