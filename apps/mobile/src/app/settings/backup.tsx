import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { businessDay, portablePassphraseOk } from '@daftarak/shared';
import { DateRangeBar, type RangeKey } from '../../features/common/DateRange';
import { useTranslation } from 'react-i18next';
import { NoScreenshots } from '../../features/NoScreenshots';
import { Screen, Text, Card, Button, Banner, IconBadge, SectionTitle, PasswordField, colors, fonts } from '../../ui';
import { fx } from '../../ui/fx';
import { useApp } from '../../state/app';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { backupNow, lastBackup, type LastBackup } from '../../features/backup/service';
import { exportPortableBackup, lastPortableBackup } from '../../features/backup/portable';
import { hasDocuments, portableReminder } from '../../domain/backup/portable';
import { getDb } from '../../db/client';
import { exportAllToExcel } from '../../features/backup/excelExport';
import { useApprovalGate } from '../../features/approval/useApprovalGate';
import type { Approval } from '../../domain/auth/approval';
import { dateTimeLabel } from '../../lib/format';

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Backups: automatic every day (with the check-in), "backup now", encrypted local copy, Excel of all data. */
export default function BackupScreen() {
  const { t, i18n } = useTranslation();
  const business = useApp((s) => s.business);
  const [last, setLast] = useState<LastBackup | null>(null);
  const [cloud, setCloud] = useState<number | null>(null);
  const [busy, setBusy] = useState<null | 'cloud' | 'local' | 'excel'>(null);
  const [p, setP] = useState<{ v: number; stage: string }>({ v: 0, stage: '' });
  const [msg, setMsg] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [lastFile, setLastFile] = useState<number | null>(null);
  const [docs, setDocs] = useState(true);
  const [form, setForm] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [passErr, setPassErr] = useState<string | null>(null);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [xRange, setXRange] = useState<{ key: RangeKey; from: number; to: number }>({ key: 'all', from: 20000101, to: today });

  const load = useCallback(() => {
    void lastBackup().then(setLast);
    void lastPortableBackup().then(setLastFile, () => undefined);
    void hasDocuments(getDb()).then(setDocs, () => setDocs(true));
    if (business?.serverBusinessId)
      void accessToken()
        .then((tk) => api.listBackups(tk, business.serverBusinessId))
        .then((r) => setCloud(r.backups.length), () => setCloud(null));
  }, [business?.serverBusinessId]);
  useFocusEffect(load);

  const gate = useApprovalGate();
  /** Excel / file exports pass «تأكيد المدير» first when the shop asks for it (cloud backups never leave the account). */
  const run = (kind: 'cloud' | 'local' | 'excel') => (kind === 'cloud' ? doRun(kind, null) : gate.run('export', (a) => doRun(kind, a)));
  const doRun = async (kind: 'cloud' | 'local' | 'excel', approval: Approval | null) => {
    setMsg(null);
    setBusy(kind);
    try {
      if (kind === 'cloud') await backupNow((v, stage) => setP({ v, stage }));
      else if (kind === 'local') {
        await exportPortableBackup(pass, (v, stage) => setP({ v, stage }), approval);
        setForm(false);
        setPass('');
        setPass2('');
      } else await exportAllToExcel({ range: xRange.key === 'all' ? null : { from: xRange.from, to: xRange.to }, onProgress: (v) => setP({ v, stage: 'excel' }), approvedBy: approval });
      fx.success();
      if (kind === 'cloud') setMsg({ tone: 'success', text: t('backup.done') });
      if (kind === 'local') setMsg({ tone: 'success', text: t('portable.done') });
      load();
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(t, e) === t('errors.unknown') ? t('backup.failed') : errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

  const startFile = () => {
    if (!portablePassphraseOk(pass)) return setPassErr(t('portable.passShort'));
    if (pass !== pass2) return setPassErr(t('portable.passMismatch'));
    setPassErr(null);
    void run('local');
  };
  const remind = portableReminder(lastFile);

  const age = last ? Date.now() - last.at : null;
  const stale = age == null || age > 3 * 86_400_000;
  return (
    <Screen back title={t('backup.title')} subtitle={t('backup.subtitle')}>
      <NoScreenshots id="backup" />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge name="shield" hue={stale ? 'amber' : 'leaf'} size={44} />
          <View style={{ flex: 1 }}>
            <Text variant="caption">{t('backup.last')}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 23, color: colors.ink.DEFAULT }}>{last ? dateTimeLabel(i18n.language, last.at) : t('backup.never')}</Text>
            {last ? <Text variant="caption">{t(`backup.kind.${last.kind}`)} · {mb(last.size)}</Text> : null}
          </View>
        </View>
        {cloud != null ? <Text variant="caption" style={{ marginTop: 8 }}>{t('backup.cloudCount', { n: cloud })}</Text> : null}
      </Card>
      {stale ? <Banner tone="warn" text={t('backup.staleHint')} /> : null}
      <Banner tone="info" text={t('backup.autoHint')} />
      {busy ? (
        <Card>
          <Text variant="subtitle">{p.stage === 'upload' ? t('backup.uploading') : p.stage === 'key' ? t('portable.securing') : p.stage === 'excel' ? t('backup.excelBuilding') : t('backup.building')}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, marginTop: 8, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round((p.stage === 'upload' ? 0.97 : p.v) * 100)}%`, height: 8, backgroundColor: colors.primary[500] }} />
          </View>
          <Text variant="caption" style={{ marginTop: 6 }}>{t('backup.keepWorking')}</Text>
        </Card>
      ) : null}
      {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}
      <Button testID="backup-now" icon="upload" title={t('backup.now')} loading={busy === 'cloud'} disabled={!!busy} onPress={() => void run('cloud')} />
      <SectionTitle>{t('portable.exportTitle')}</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge name="file" hue={remind.due ? 'amber' : 'leaf'} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>
              {remind.days == null ? t('portable.never') : remind.days === 0 ? t('portable.lastToday') : t('portable.lastAgo', { n: remind.days })}
            </Text>
            <Text variant="caption">{t('portable.exportHint')}</Text>
          </View>
        </View>
      </Card>
      {remind.due ? <Banner tone="warn" text={t('portable.remind')} /> : null}
      {form ? (
        <Card>
          <View style={{ gap: 10 }}>
            <Text variant="caption">{t('portable.passSuggest')}</Text>
            <PasswordField testID="portable-pass1" label={t('portable.passLabel')} value={pass} onChangeText={setPass} />
            <PasswordField testID="portable-pass2" label={t('portable.passConfirm')} value={pass2} onChangeText={setPass2} error={passErr} onSubmitEditing={startFile} />
            <Banner tone="warn" text={t('portable.forgetWarn')} />
            <Button testID="portable-create" icon="upload" title={t('portable.create')} loading={busy === 'local'} disabled={!!busy || !pass || !pass2} onPress={startFile} />
            <Button kind="ghost" compact title={t('common.cancel')} disabled={!!busy} onPress={() => (setForm(false), setPass(''), setPass2(''), setPassErr(null))} />
            <Text variant="caption">{t('portable.shareHint')}</Text>
          </View>
        </Card>
      ) : (
        <Button testID="portable-start" kind="secondary" icon="file" title={t('portable.exportTitle')} disabled={!!busy} onPress={() => setForm(true)} />
      )}
      <SectionTitle>{t('backup.offline')}</SectionTitle>
      <Text variant="caption">{t('backup.excelRange')}</Text>
      <DateRangeBar value={xRange} today={today} onChange={setXRange} presets={['all', 'month', 'lastMonth', 'year', 'custom']} />
      <Button kind="secondary" icon="sheet" title={t('backup.excel')} loading={busy === 'excel'} disabled={!!busy} onPress={() => void run('excel')} />
      <Text variant="caption">{t('backup.privacy')}</Text>
      {docs ? <Text variant="caption">{t('portable.restoreHasDocs')}</Text> : <Button kind="ghost" icon="download" title={t('portable.restoreTitle')} disabled={!!busy} onPress={() => router.push('/settings/restore-file')} />}
      {gate.sheet}
    </Screen>
  );
}
