/** Cashier phone, home: are this phone's sales with the shop's main phone yet? */
import { useTranslation } from 'react-i18next';
import { Banner } from '../../ui';
import { isCashierPhone } from '../../domain/sync/role';
import { runSync, useSync } from './engine';

export function SyncBadge() {
  const { t } = useTranslation();
  const pending = useSync((s) => s.pending);
  const stopped = useSync((s) => s.stopped);
  if (!isCashierPhone()) return null;
  if (stopped) return <Banner testID="sync-stopped" tone="danger" icon="warning" text={t('sync.stopped')} />;
  if (pending > 0) return <Banner testID="sync-pending" tone="warn" icon="cloudOff" text={t('sync.pending', { n: pending })} action={t('common.retry')} onAction={() => void runSync()} />;
  return <Banner testID="sync-ok" tone="success" icon="check" text={t('sync.allSent')} />;
}
