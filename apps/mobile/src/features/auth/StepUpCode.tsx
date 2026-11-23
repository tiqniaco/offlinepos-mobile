import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, Button, Banner, OtpInput } from '../../ui';
import { api, ApiError } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { useSmsOtp } from './useSmsOtp';
import { SmsOtpHint } from './SmsOtpHint';

/**
 * SMS step-up for a sensitive action on this session (using a shop that is active on another phone, releasing the
 * backup key…). Sends the code when shown, reads it from the SMS on Android, and calls `onVerified` once the server
 * accepted it (the session then has a ~10-minute step-up window).
 */
export function StepUpCode({ token, onVerified, onCancel }: { token: string; onVerified: () => void | Promise<void>; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const verifying = useRef(false);
  const sms = useSmsOtp((c) => {
    if (verifying.current) return;
    setCode(c);
    void verify(c);
  });

  const send = async () => {
    setErr(null);
    sms.restart(); // listen before the SMS is sent
    try {
      await api.stepUpRequest(token);
      setSent(true);
    } catch (e) {
      // A code sent less than a minute ago is still valid: let the user type it.
      if (e instanceof ApiError && e.code === 'otp_cooldown') setSent(true);
      else setErr(errorMessage(t, e));
    }
  };

  useEffect(() => {
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const verify = async (value = code) => {
    if (verifying.current || value.length !== 6) return;
    verifying.current = true;
    setBusy(true);
    setErr(null);
    try {
      await api.stepUpVerify(token, value);
      await onVerified();
    } catch (e) {
      setErr(errorMessage(t, e));
      setCode('');
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Banner tone="info" icon="lock" text={t('stepUp.why')} />
      {sent ? <Text variant="body">{t('stepUp.sent')}</Text> : null}
      <OtpInput testID="stepup-code" value={code} onChange={setCode} error={!!err} />
      <SmsOtpHint show={sms.supported} />
      {err ? <Banner tone="danger" text={err} /> : null}
      <Button testID="stepup-verify" title={t('stepUp.verify')} loading={busy} disabled={code.length !== 6 || busy} onPress={() => void verify()} />
      <Button kind="ghost" title={t('stepUp.resend')} disabled={busy} onPress={() => void send()} />
      {onCancel ? <Button kind="ghost" title={t('common.cancel')} disabled={busy} onPress={onCancel} /> : null}
    </>
  );
}
