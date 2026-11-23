/** Turn cloud backups back on for a phone that joined its shop without the server backup key: SMS step-up → fetch key. */
import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Banner, Text } from '../../ui';
import { StepUpCode } from '../../features/auth/StepUpCode';
import { accessToken } from '../../lib/session';
import { adoptServerBackupKey } from '../../domain/onboarding';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { fx } from '../../ui/fx';
import { errorMessage } from '../../lib/errors';

export default function BackupKeyScreen() {
  const { t } = useTranslation();
  const business = useApp((s) => s.business);
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    accessToken().then(setToken, (e) => setErr(errorMessage(t, e)));
  }, [t]);

  const done = async () => {
    if (!business?.serverBusinessId || !token) return;
    const ok = await adoptServerBackupKey(getDb(), await accessToken(), business.serverBusinessId);
    if (ok) {
      fx.success();
      toast(t('backup.keyRestored'), 'success');
      router.back();
    } else setErr(t('backup.keyFailed'));
  };

  return (
    <Screen back title={t('backup.keyTitle')}>
      <Text variant="body">{t('backup.keyBody')}</Text>
      {err ? <Banner tone="danger" text={err} /> : null}
      {token ? <StepUpCode token={token} onVerified={done} onCancel={() => router.back()} /> : null}
    </Screen>
  );
}
