import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NoScreenshots } from '../../features/NoScreenshots';
import { Screen, Text, Card, Button, Banner, IconBadge, SectionTitle, colors, fonts } from '../../ui';
import { fx } from '../../ui/fx';
import { useApp } from '../../state/app';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { backupNow, exportLocalBackup, lastBackup, type LastBackup } from '../../features/backup/service';
import { exportAllToExcel } from '../../features/backup/excelExport';
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

  const load = useCallback(() => {
    void lastBackup().then(setLast);
    if (business?.serverBusinessId)
      void accessToken()
        .then((tk) => api.listBackups(tk, business.serverBusinessId))
        .then((r) => setCloud(r.backups.length), () => setCloud(null));
  }, [business?.serverBusinessId]);
  useFocusEffect(load);

  const run = async (kind: 'cloud' | 'local' | 'excel') => {
    setMsg(null);
    setBusy(kind);
    try {
      if (kind === 'cloud') await backupNow((v, stage) => setP({ v, stage }));
      else if (kind === 'local') await exportLocalBackup((v) => setP({ v, stage: 'build' }));
      else await exportAllToExcel();
      fx.success();
      if (kind === 'cloud') setMsg({ tone: 'success', text: t('backup.done') });
      load();
    } catch (e) {
      setMsg({ tone: 'danger', text: errorMessage(t, e) === t('errors.unknown') ? t('backup.failed') : errorMessage(t, e) });
    } finally {
      setBusy(null);
    }
  };

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
          <Text variant="subtitle">{p.stage === 'upload' ? t('backup.uploading') : t('backup.building')}</Text>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, marginTop: 8, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round((p.stage === 'upload' ? 0.97 : p.v) * 100)}%`, height: 8, backgroundColor: colors.primary[500] }} />
          </View>
          <Text variant="caption" style={{ marginTop: 6 }}>{t('backup.keepWorking')}</Text>
        </Card>
      ) : null}
      {msg ? <Banner tone={msg.tone} text={msg.text} /> : null}
      <Button testID="backup-now" icon="upload" title={t('backup.now')} loading={busy === 'cloud'} disabled={!!busy} onPress={() => void run('cloud')} />
      <SectionTitle>{t('backup.offline')}</SectionTitle>
      <Button kind="secondary" icon="file" title={t('backup.local')} loading={busy === 'local'} disabled={!!busy} onPress={() => void run('local')} />
      <Button kind="secondary" icon="sheet" title={t('backup.excel')} loading={busy === 'excel'} disabled={!!busy} onPress={() => void run('excel')} />
      <Text variant="caption">{t('backup.privacy')}</Text>
    </Screen>
  );
}
