/**
 * "Sign in again" (shown only when the server dropped this phone's session). The licence keeps working offline
 * meanwhile; an SMS code to the account phone restores the session on THIS device (no new device code).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Banner, Button, Card, OtpInput, PhoneField, Text } from '../../ui';
import { api } from '../../api/client';
import { getDb } from '../../db/client';
import { getMeta } from '../../domain/device';
import { deviceInfo } from '../../domain/onboarding';
import { onSessionChange, reauthenticate, sessionSignedOut } from '../../domain/licence/service';
import { errorMessage } from '../../lib/errors';
import { fx } from '../../ui/fx';

export function ReauthCard({ onDone }: { onDone?: () => void }) {
  const { t, i18n } = useTranslation();
  const signedOut = useSyncExternalStore(onSessionChange, sessionSignedOut);
  const [phone, setPhone] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!signedOut) return;
    void getMeta(getDb(), 'account.phone').then((p) => p && setPhone((v) => v || (p.startsWith('20') ? `0${p.slice(2)}` : p)), () => undefined);
  }, [signedOut]);
  if (!signedOut) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await api.requestOtp(phone, i18n.language === 'en' ? 'en' : 'ar');
      setSent(true);
    });
  const verify = () =>
    run(async () => {
      const auth = await api.verifyOtp(phone, code, await deviceInfo());
      await reauthenticate(getDb(), auth);
      fx.success();
      onDone?.();
    });

  return (
    <Card>
      <View style={{ gap: 10 }}>
        <Text variant="body">{t('licence.signedOutBody')}</Text>
        <PhoneField testID="reauth-phone" value={phone} onChangeText={setPhone} />
        {sent ? (
          <>
            <OtpInput testID="reauth-code" value={code} onChange={setCode} />
            <Button testID="reauth-verify" title={t('licence.signInAgain')} loading={busy} disabled={busy || code.length < 6} onPress={() => void verify()} />
            <Button kind="ghost" compact title={t('licence.resendCode')} disabled={busy} onPress={() => void send()} />
          </>
        ) : (
          <Button testID="reauth-send" icon="phone" title={t('licence.sendCode')} loading={busy} disabled={busy || phone.replace(/\D/g, '').length < 10} onPress={() => void send()} />
        )}
        {err ? <Banner tone="danger" text={err} /> : null}
      </View>
    </Card>
  );
}
