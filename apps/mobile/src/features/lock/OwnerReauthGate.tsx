/**
 * Opening «القفل والأمان» or «المستخدمين والصلاحيات» needs the owner again: fingerprint / face when the owner turned
 * it on (the phone's own passcode is offered as fallback, as on the lock screen), else the owner's password.
 * Valid 2 minutes (see reauth.ts). Children mount only after the check.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { Screen, Text, Card, Button, PasswordField, IconBadge, Banner } from '../../ui';
import { getDb } from '../../db/client';
import { listActiveUsers, unlockWithPin, PinError } from '../../domain/auth/users';
import { markReauth, reauthFresh } from './reauth';
import { withLockHold } from '../../state/lockHold';

type Owner = Awaited<ReturnType<typeof listActiveUsers>>[number];

export function OwnerReauthGate({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [ok, setOk] = useState(reauthFresh);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [bio, setBio] = useState(false);
  const [secret, setSecret] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pass = useCallback(() => {
    markReauth();
    setOk(true);
  }, []);

  const tryBio = useCallback(async () => {
    try {
      // The phone's prompt (and its passcode screen) must not trigger the auto-lock or the app-switcher cover.
      const r = await withLockHold(() => LocalAuthentication.authenticateAsync({ promptMessage: t('reauth.prompt'), disableDeviceFallback: false, fallbackLabel: t('lock.usePhoneCode'), cancelLabel: t('common.cancel') }));
      if (r.success) pass();
    } catch {
      // the password stays available
    }
  }, [t, pass]);

  useEffect(() => {
    if (ok) return;
    let alive = true;
    void (async () => {
      const all = await listActiveUsers(getDb()).catch(() => []);
      const o = all.find((u) => u.secretKind === 'password') ?? all.find((u) => u.roleKey === 'owner') ?? null;
      if (!alive) return;
      setOwner(o);
      const hw = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => h && e, () => false);
      if (!alive) return;
      const canBio = !!o?.biometricEnabled && hw;
      setBio(canBio);
      // Never while the screen is still sliding in: opening the phone's prompt during the transition left a black
      // screen on some Android phones. A short pause, then ask (the button stays for a second try).
      if (canBio) setTimeout(() => alive && void tryBio(), 650);
    })();
    return () => {
      alive = false;
    };
  }, [ok, tryBio]);

  const submit = async () => {
    if (!owner || !secret || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      await unlockWithPin(getDb(), owner.id, secret);
      pass();
    } catch (e) {
      setSecret('');
      if (e instanceof PinError && e.code === 'locked' && e.lockedUntil) setMsg(t('lock.lockedFor', { time: t('lock.minutes', { n: Math.max(1, Math.ceil((e.lockedUntil - Date.now()) / 60_000)) }) }));
      else setMsg(t(owner.secretKind === 'password' ? 'lock.wrongPassword' : 'lock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  if (ok) return <>{children}</>;
  return (
    <Screen back title={title} footer={<Button testID="reauth-ok" title={t('reauth.confirm')} loading={busy} disabled={!owner || !secret} onPress={() => void submit()} />}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge name="shield" hue="primary" size={44} />
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">{t('reauth.title')}</Text>
            <Text variant="caption">{t('reauth.body', { name: owner?.name ?? '' })}</Text>
          </View>
        </View>
      </Card>
      {bio ? <Button kind="secondary" icon="fingerprint" title={t('reauth.biometric')} onPress={() => void tryBio()} /> : null}
      <PasswordField testID="reauth-secret" label={owner?.secretKind === 'pin' ? t('users.pin') : t('login.password')} value={secret} onChangeText={(v) => (setSecret(v), setMsg(null))} onSubmitEditing={() => void submit()} error={msg} />
      {!owner ? <Banner tone="info" text={t('common.loading')} /> : null}
    </Screen>
  );
}
