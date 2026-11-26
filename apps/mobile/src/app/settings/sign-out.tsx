/**
 * «تسجيل الخروج من الموبايل ده»: the shop's data lives on the phone, so signing out removes it from this phone.
 * The account and the shop stay; signing in again brings the data back from a backup. A fresh backup comes first.
 */
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, Banner, Button, IconBadge, colors, fonts } from '../../ui';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { dateTimeLabel } from '../../lib/format';
import { lastBackup, type LastBackup } from '../../features/backup/service';
import { signOutThisPhone } from '../../features/account/deleteAccount';
import { boot } from '../../state/boot';

const FRESH_MS = 24 * 3_600_000;

export default function SignOutScreen() {
  const { t, i18n } = useTranslation();
  const [last, setLast] = useState<LastBackup | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void lastBackup().then(setLast, () => setLast(null));
    }, []),
  );
  const fresh = !!last && Date.now() - last.at < FRESH_MS;

  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const token = await accessToken().catch(() => null);
      await signOutThisPhone(token);
      await boot(); // empty phone → welcome screen
      router.replace('/');
    } catch (e) {
      setErr(errorMessage(t, e));
      setBusy(false);
    }
  };
  const confirm = () =>
    Alert.alert(t('signOut.confirmTitle'), fresh ? t('signOut.confirmBody') : t('signOut.confirmNoBackup'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('signOut.confirmGo'), style: 'destructive', onPress: () => void go() },
    ]);

  return (
    <Screen back title={t('signOut.title')}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge name="phone" hue="sky" size={44} />
          <Text style={{ flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{t('signOut.headline')}</Text>
        </View>
        <View style={{ gap: 6, marginTop: 12 }}>
          {(['erase', 'keep', 'back'] as const).map((k) => (
            <Text key={k} variant="body">
              • {t(`signOut.what.${k}`)}
            </Text>
          ))}
        </View>
      </Card>
      {last === undefined ? null : fresh ? (
        <Banner tone="success" text={t('signOut.backupOk', { at: dateTimeLabel(i18n.language, last!.at) })} />
      ) : (
        <Banner tone="warn" text={last ? t('signOut.backupOld', { at: dateTimeLabel(i18n.language, last.at) }) : t('signOut.backupNone')} action={t('signOut.backupAction')} onAction={() => router.push('/settings/backup')} />
      )}
      {err ? <Banner tone="danger" text={err} /> : null}
      <Button testID="sign-out-go" kind={fresh ? 'primary' : 'danger'} icon="lock" title={t('signOut.go')} loading={busy} disabled={busy || last === undefined} onPress={confirm} />
    </Screen>
  );
}
