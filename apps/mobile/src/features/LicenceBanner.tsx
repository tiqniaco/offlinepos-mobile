import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '../ui';
import { useApp } from '../state/app';
import { backgroundCheckin } from '../state/boot';

/** Shows trial days / grace / free / read-only with the reason, and a "connect & refresh" action. */
export function LicenceBanner() {
  const { t } = useTranslation();
  const l = useApp((s) => s.licence);
  const [busy, setBusy] = useState(false);
  if (!l) return null;
  const refresh = async () => {
    setBusy(true);
    await backgroundCheckin(true).catch(() => undefined);
    setBusy(false);
  };
  if (l.mode === 'read_only' || l.mode === 'needs_checkin') {
    const reason = t(`licence.reason.${l.reason}`, { defaultValue: '' });
    return <Banner testID="licence-banner" tone="danger" text={`${t('licence.readOnly')} ${reason}`} action={busy ? '…' : t('licence.checkNow')} onAction={refresh} />;
  }
  if (l.mode === 'grace') return <Banner testID="licence-banner" tone="warn" text={t('licence.grace', { days: l.graceDaysLeft })} />;
  if (l.mode === 'free') return <Banner testID="licence-banner" tone="info" text={t('licence.free')} />;
  if (l.trialDaysLeft != null) return <Banner testID="licence-banner" tone="info" text={t('licence.trial', { days: l.trialDaysLeft })} />;
  return null;
}
