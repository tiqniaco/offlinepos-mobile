/**
 * «النسخ التلقائي على Google Drive»: connect once (Google's own sign-in), then a password-protected copy goes to the
 * «Kashiro Backups» folder in the owner's Drive every day. Uses the same backup password as the folder backup.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, Card, Button, Banner, IconBadge, PasswordField, colors, fonts } from '../../ui';
import { fx } from '../../ui/fx';
import { dateTimeLabel } from '../../lib/format';
import { FolderPassError } from '../../domain/backup/folder';
import type { Approval } from '../../domain/auth/approval';
import { approveDataExport } from '../approval/exportGate';
import { hasFolderPassphrase, setFolderPassphrase } from './folderBackup';
import { connectDrive, disconnectDrive, driveAvailable, driveState, runDriveBackup, DRIVE_FOLDER_NAME, type DriveState } from './drive';

export function DriveBackupCard({ gated, disabled }: { gated: (fn: (a: Approval | null) => Promise<void>) => void; disabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const [st, setSt] = useState<DriveState | null>(null);
  const [hasPass, setHasPass] = useState(false);
  const [askPass, setAskPass] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger' | 'warn'; text: string } | null>(null);

  const load = useCallback(() => {
    void driveState().then(setSt, () => setSt(null));
    void hasFolderPassphrase().then(setHasPass, () => setHasPass(false));
  }, []);
  useFocusEffect(load);

  if (!driveAvailable()) return null;
  const connected = !!st?.email;
  const errText = (code: string) => t(`driveBackup.err.${code}`, { defaultValue: t('driveBackup.err.drive_failed') });

  const upload = async () => {
    setBusy(true);
    setMsg(null);
    const r = await runDriveBackup({ force: true });
    setBusy(false);
    if (r.ok) fx.success();
    setMsg(r.ok ? { tone: 'success', text: t('driveBackup.done') } : { tone: 'danger', text: errText(r.error ?? 'drive_failed') });
    load();
  };

  const connect = () =>
    gated(async (approval) => {
      setMsg(null);
      if (!hasPass) {
        try {
          await setFolderPassphrase(pass, pass2);
        } catch (e) {
          setMsg({ tone: 'danger', text: e instanceof FolderPassError ? t(e.code === 'pass_short' ? 'portable.passShort' : 'portable.passMismatch') : t('errors.unknown') });
          return;
        }
      }
      await approveDataExport('export', 'portable', approval);
      setBusy(true);
      try {
        const email = await connectDrive();
        if (!email) return;
        setAskPass(false);
        setPass('');
        setPass2('');
        load();
        setBusy(false);
        await upload();
      } catch (e) {
        setMsg({ tone: 'danger', text: errText(e instanceof Error && /^drive_/.test(e.message) ? e.message : 'connect_failed') });
      } finally {
        setBusy(false);
      }
    });

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <IconBadge name="upload" hue={connected ? 'leaf' : 'primary'} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 24, color: colors.ink.DEFAULT }}>{t('driveBackup.title')}</Text>
          <Text variant="caption">
            {connected
              ? [t('driveBackup.account', { email: st!.email }), t('driveBackup.folder', { name: DRIVE_FOLDER_NAME }), st!.lastOkAt ? t('driveBackup.last', { at: dateTimeLabel(i18n.language, st!.lastOkAt) }) : t('driveBackup.never')].join('\n')
              : t('driveBackup.hint')}
          </Text>
        </View>
      </View>
      <View style={{ gap: 8, marginTop: 12 }}>
        {connected && st?.lastError ? <Banner tone="warn" text={errText(st.lastError)} /> : null}
        {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}
        {!connected && !hasPass && askPass ? (
          <>
            <Text variant="caption">{t('driveBackup.passHint')}</Text>
            <PasswordField label={t('portable.passLabel')} value={pass} onChangeText={setPass} />
            <PasswordField label={t('portable.passConfirm')} value={pass2} onChangeText={setPass2} />
            <Banner tone="warn" text={t('portable.forgetWarn')} />
          </>
        ) : null}
        {connected ? (
          <>
            <Button testID="drive-upload" icon="upload" title={t('driveBackup.uploadNow')} loading={busy} disabled={disabled || busy} onPress={() => void upload()} />
            <Button kind="ghost" compact title={t('driveBackup.disconnect')} disabled={busy} onPress={() => void disconnectDrive().then(load)} />
          </>
        ) : (
          <Button
            testID="drive-connect"
            icon="upload"
            title={t('driveBackup.connect')}
            loading={busy}
            disabled={disabled || busy || (!hasPass && askPass && (!pass || !pass2))}
            onPress={() => (!hasPass && !askPass ? setAskPass(true) : connect())}
          />
        )}
      </View>
    </Card>
  );
}
