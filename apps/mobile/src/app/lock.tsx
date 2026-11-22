import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { Screen, Text, PinPad, colors } from '../ui';
import { getDb } from '../db/client';
import { listActiveUsers, unlockWithBiometric, unlockWithPin, PinError } from '../domain/auth/users';
import { useApp } from '../state/app';

type LockUser = Awaited<ReturnType<typeof listActiveUsers>>[number];

function Avatar({ name, color, size = 56 }: { name: string; color: string; size?: number }) {
  return (
    <View className="items-center justify-center rounded-full" style={{ width: size, height: size, backgroundColor: color + '22', borderWidth: 2, borderColor: color }}>
      <Text className="font-bold text-[22px] leading-[30px]" style={{ color }}>
        {name.trim().charAt(0)}
      </Text>
    </View>
  );
}

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
    void listActiveUsers(getDb()).then((u) => {
      setUsers(u);
      if (u.length === 1) setSelected(u[0]!);
    });
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => setBioAvailable(h && e));
  }, []);

  const tryBiometric = useCallback(async (u: LockUser) => {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.biometricPrompt'), disableDeviceFallback: true, cancelLabel: t('common.cancel') });
    if (r.success) useApp.getState().unlock(await unlockWithBiometric(getDb(), u.id));
  }, [t]);

  useEffect(() => {
    if (selected?.biometricEnabled && bioAvailable) void tryBiometric(selected);
  }, [selected, bioAvailable, tryBiometric]);

  const submit = async (value: string) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      useApp.getState().unlock(await unlockWithPin(getDb(), selected.id, value));
    } catch (e) {
      setPin('');
      if (e instanceof PinError && e.code === 'locked' && e.lockedUntil) {
        const secs = Math.ceil((e.lockedUntil - Date.now()) / 1000);
        setMsg(t('lock.lockedFor', { time: secs >= 60 ? `${Math.ceil(secs / 60)} د` : `${secs} ث` }));
      } else setMsg(t('lock.wrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll={false}>
      <View className="flex-1 justify-between pb-6 pt-10">
        <View className="items-center gap-1">
          <Text variant="caption">{business?.name}</Text>
          <Text variant="title">{selected ? selected.name : t('lock.title')}</Text>
          {selected ? <Text variant="caption">{selected.roleName}</Text> : null}
        </View>

        {!selected ? (
          <View className="flex-row flex-wrap justify-center gap-5">
            {users.map((u) => (
              <Pressable key={u.id} testID={`user-${u.name}`} onPress={() => { setSelected(u); setMsg(null); }} className="items-center gap-2 active:opacity-70">
                <Avatar name={u.name} color={u.color} size={72} />
                <Text variant="label">{u.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <View className="items-center gap-4">
            <Avatar name={selected.name} color={selected.color} />
            <Text variant="label" className={msg ? 'text-rose-700' : ''}>
              {msg ?? t('lock.enterPin')}
            </Text>
            <PinPad
              value={pin}
              onChange={(v) => { setPin(v); setMsg(null); }}
              length={4}
              maxLength={6}
              onBiometric={selected.biometricEnabled && bioAvailable ? () => void tryBiometric(selected) : undefined}
              error={!!msg}
              disabled={busy}
            />
            <View className="flex-row gap-3">
              <Pressable testID="pin-ok" onPress={() => void submit(pin)} disabled={pin.length < 4} className={`rounded-field px-8 py-3 ${pin.length < 4 ? 'bg-paper-sunk' : 'bg-teal-600 active:bg-teal-700'}`}>
                <Text variant="subtitle" className={pin.length < 4 ? 'text-ink-faint' : 'text-white'}>
                  {t('common.done')}
                </Text>
              </Pressable>
              {users.length > 1 ? (
                <Pressable onPress={() => { setSelected(null); setPin(''); setMsg(null); }} className="rounded-field px-4 py-3 active:bg-paper-sunk">
                  <Text variant="label" style={{ color: colors.teal[700] }}>
                    {t('lock.switchUser')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
      </View>
    </Screen>
  );
}
