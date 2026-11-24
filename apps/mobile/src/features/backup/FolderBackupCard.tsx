/**
 * «النسخ التلقائي في فولدر عندك» on the backup screen: pick a folder once (Android SAF), set the backup password
 * once (kept in the keystore), then a daily .kashiro file is written there (newest 7 kept). iOS: a weekly reminder
 * and the share sheet («احفظ ملف»), handled by the screen's own file section.
 */
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text, Card, Button, Banner, IconBadge, PasswordField, colors, fonts } from '../../ui';
import { fx } from '../../ui/fx';
import { dateTimeLabel } from '../../lib/format';
import { FolderPassError, folderBackupWarning, type FolderConfig } from '../../domain/backup/folder';
import { approveDataExport } from '../approval/exportGate';
import type { Approval } from '../../domain/auth/approval';
import { disableFolderBackup, folderBackupSupported, folderConfig, hasFolderPassphrase, pickBackupFolder, runFolderBackup, setFolderPassphrase } from './folderBackup';

export function FolderBackupCard({ gated, disabled }: { gated: (fn: (a: Approval | null) => Promise<void>) => void; disabled?: boolean }) {
  const { t, i18n } = useTranslation();
  const [cfg, setCfg] = useState<FolderConfig | null>(null);
  const [hasPass, setHasPass] = useState(false);
  const [form, setForm] = useState<null | 'setup' | 'pass'>(null);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const load = useCallback(() => {
    void folderConfig().then(setCfg, () => setCfg(null));
    void hasFolderPassphrase().then(setHasPass, () => setHasPass(false));
  }, []);
  useFocusEffect(load);

  if (!folderBackupSupported()) {
    return Platform.OS === 'ios' ? <Banner tone="info" title={t('folderBackup.title')} text={t('folderBackup.iosHint')} /> : null;
  }

  const savePass = async () => {
    try {
      await setFolderPassphrase(pass, pass2);
      setErr(null);
      return true;
    } catch (e) {
      setErr(e instanceof FolderPassError ? t(e.code === 'pass_short' ? 'portable.passShort' : 'portable.passMismatch') : t('errors.unknown'));
      return false;
    }
  };
  const runNow = async () => {
    setBusy(true);
    setMsg(null);
    const r = await runFolderBackup({ force: true });
    setBusy(false);
    if (r.ok) fx.success();
    setMsg(r.ok ? { tone: 'success', text: t('folderBackup.done') } : { tone: 'danger', text: t(`folderBackup.err.${r.error ?? 'write_failed'}`, { defaultValue: t('folderBackup.err.write_failed') }) });
    load();
  };
  /** Set up (or change the folder): password first when there is none, the export approval, then the picker. */
  const setup = () =>
    gated(async (approval) => {
      if ((form === 'setup' || !hasPass) && !(await savePass())) return;
      await approveDataExport('export', 'portable', approval);
      const c = await pickBackupFolder();
      if (!c) return;
      setForm(null);
      setPass('');
      setPass2('');
      load();
      await runNow();
    });

  const warn = folderBackupWarning(cfg);
  if (!cfg || form === 'setup') {
    return (
      <Card>
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <IconBadge name="download" hue="leaf" size={40} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{t('folderBackup.title')}</Text>
              <Text variant="caption">{t('folderBackup.pitch')}</Text>
            </View>
          </View>
          <Text variant="caption">{t('folderBackup.pickHint')}</Text>
          {form === 'setup' || !hasPass ? (
            <>
              <Text variant="caption">{t('folderBackup.passHint')}</Text>
              <PasswordField testID="folder-pass1" label={t('portable.passLabel')} value={pass} onChangeText={setPass} />
              <PasswordField testID="folder-pass2" label={t('portable.passConfirm')} value={pass2} onChangeText={setPass2} error={err} />
              <Banner tone="warn" text={t('portable.forgetWarn')} />
            </>
          ) : null}
          <Button testID="folder-pick" icon="download" title={t('folderBackup.pick')} loading={busy} disabled={disabled || busy || ((form === 'setup' || !hasPass) && (!pass || !pass2))} onPress={setup} />
          {form === 'setup' ? <Button kind="ghost" compact title={t('common.cancel')} onPress={() => (setForm(null), setErr(null))} /> : null}
          {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}
        </View>
      </Card>
    );
  }
  return (
    <Card>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge name="download" hue={warn ? 'amber' : 'leaf'} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{t('folderBackup.title')}</Text>
            <Text variant="caption">{t('folderBackup.folder', { name: cfg.label || '—' })}</Text>
            <Text variant="caption">{cfg.lastOkAt ? t('folderBackup.lastOk', { at: dateTimeLabel(i18n.language, cfg.lastOkAt) }) : t('folderBackup.never')}</Text>
            <Text variant="caption">{t('folderBackup.keeps')}</Text>
          </View>
        </View>
        {warn ? <Banner tone="warn" text={t('folderBackup.warn', { n: warn.days })} /> : null}
        {!hasPass ? <Banner tone="warn" text={t('folderBackup.err.no_password')} /> : null}
        {form === 'pass' ? (
          <>
            <PasswordField label={t('portable.passLabel')} value={pass} onChangeText={setPass} />
            <PasswordField label={t('portable.passConfirm')} value={pass2} onChangeText={setPass2} error={err} />
            <Button
              title={t('common.save')}
              disabled={!pass || !pass2}
              onPress={() =>
                void savePass().then((ok) => {
                  if (!ok) return;
                  setForm(null);
                  setPass('');
                  setPass2('');
                  setMsg({ tone: 'success', text: t('folderBackup.passSaved') });
                  load();
                })
              }
            />
            <Button kind="ghost" compact title={t('common.cancel')} onPress={() => (setForm(null), setErr(null))} />
          </>
        ) : null}
        {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}
        <Button testID="folder-now" kind="secondary" icon="download" title={t('folderBackup.now')} loading={busy} disabled={disabled || busy || !hasPass} onPress={() => void runNow()} />
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button kind="ghost" compact title={t('folderBackup.change')} disabled={busy} onPress={() => (hasPass ? setup() : setForm('setup'))} />
          <Button kind="ghost" compact title={t('folderBackup.changePass')} disabled={busy} onPress={() => setForm('pass')} />
          <Button kind="ghost" compact title={t('folderBackup.off')} disabled={busy} onPress={() => void disableFolderBackup().then(load)} />
        </View>
      </View>
    </Card>
  );
}
