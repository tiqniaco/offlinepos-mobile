import { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { Screen, Text, Choice, SectionTitle, Card, IconBadge, Banner, colors } from '../../ui';
import { getDb } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { updateUser } from '../../domain/auth/users';
import { useApp } from '../../state/app';
import { reloadAppData } from '../../state/boot';
import { errorMessage } from '../../lib/errors';

const OPTIONS = [1, 5, 15, 30, 0];

export default function Security() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const minutes = useApp((s) => s.settings.autoLockMinutes ?? 5);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bio, setBio] = useState(user.biometricEnabled);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => setBioAvailable(h && e));
  }, []);

  const setLock = async (n: number) => {
    await changeSetting(getDb(), 'autoLockMinutes', n, { userId: user.id, deviceId: device.id });
    await reloadAppData();
  };

  const toggleBio = async (v: boolean) => {
    setErr(null);
    try {
      if (v) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.biometricPrompt'), disableDeviceFallback: true });
        if (!r.success) return;
      }
      await updateUser(getDb(), user, user.id, { biometricEnabled: v }, device);
      setBio(v);
      useApp.getState().set({ user: { ...user, biometricEnabled: v } });
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };

  return (
    <Screen back title={t('more.security')}>
      {bioAvailable ? (
        <Card>
          <View className="flex-row items-center gap-3">
            <IconBadge name="fingerprint" hue="teal" />
            <Text variant="subtitle" className="flex-1">
              {t('security.biometric')}
            </Text>
            <Switch value={bio} onValueChange={(v) => void toggleBio(v)} trackColor={{ true: colors.teal[500], false: colors.paper.line }} />
          </View>
        </Card>
      ) : null}
      <SectionTitle>{t('security.autoLock')}</SectionTitle>
      <View className="flex-row flex-wrap gap-2">
        {OPTIONS.map((n) => (
          <View key={n} style={{ width: '48%' }}>
            <Choice compact title={n === 0 ? t('security.never') : t('security.minutes', { n })} selected={minutes === n} onPress={() => void setLock(n)} />
          </View>
        ))}
      </View>
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
