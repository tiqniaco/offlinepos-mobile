import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { getDb } from '../db/client';
import { listActiveUsers, unlockWithBiometric, unlockWithPin, PinError } from '../domain/auth/users';
import { useApp } from '../state/app';
import { LockView, type LockUser } from '../features/lock/LockView';

export default function LockScreen() {
  const { t } = useTranslation();
  const business = useApp((s) => s.business);
  const [users, setUsers] = useState<LockUser[]>([]);
  const [selected, setSelected] = useState<LockUser | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);

  useEffect(() => {
    void listActiveUsers(getDb()).then(
      (u) => {
        setUsers(u);
        if (u.length === 1) setSelected(u[0]!);
      },
      () => setMsg(t('lock.wrong')),
    );
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(
      ([h, e]) => setBioAvailable(h && e),
      () => setBioAvailable(false),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryBiometric = useCallback(
    async (u: LockUser) => {
      // Fingerprint / face first; if it fails the phone offers its own passcode (device fallback).
      try {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.biometricPrompt'), disableDeviceFallback: false, fallbackLabel: t('lock.usePhoneCode'), cancelLabel: t('common.cancel') });
        if (r.success) useApp.getState().unlock(await unlockWithBiometric(getDb(), u.id));
      } catch {
        setMsg(t(u.secretKind === 'password' ? 'lock.wrongPassword' : 'lock.wrong'));
      }
    },
    [t],
  );

  useEffect(() => {
    if (selected?.biometricEnabled && bioAvailable) void tryBiometric(selected);
  }, [selected, bioAvailable, tryBiometric]);

  const submit = async () => {
    if (!selected || busy || pin.length < (selected.secretKind === 'password' ? 1 : 4)) return;
    setBusy(true);
    try {
      useApp.getState().unlock(await unlockWithPin(getDb(), selected.id, pin));
    } catch (e) {
      setPin('');
      if (e instanceof PinError && e.code === 'locked' && e.lockedUntil) {
        const secs = Math.ceil((e.lockedUntil - Date.now()) / 1000);
        setMsg(t('lock.lockedFor', { time: secs >= 60 ? t('lock.minutes', { n: Math.ceil(secs / 60) }) : t('lock.seconds', { n: Math.max(1, secs) }) }));
      } else setMsg(t(selected.secretKind === 'password' ? 'lock.wrongPassword' : 'lock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockView
      businessName={business?.name ?? ''}
      users={users}
      selected={selected}
      pin={pin}
      message={msg}
      busy={busy}
      bioAvailable={bioAvailable}
      onSelect={(u) => {
        setSelected(u);
        setPin('');
        setMsg(null);
      }}
      onPin={(v) => {
        setPin(v);
        setMsg(null);
      }}
      onSubmit={() => void submit()}
      onBiometric={() => selected && void tryBiometric(selected)}
      onForgot={selected?.secretKind === 'password' ? () => router.push({ pathname: '/unlock-reset', params: { userId: selected.id } }) : undefined}
    />
  );
}
