import { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { roleHas } from '@daftarak/shared';
import { Screen, Text, Choice, SectionTitle, Card, IconBadge, Icon, Banner, colors } from '../../ui';
import { getDb } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { updateUser } from '../../domain/auth/users';
import { useApp } from '../../state/app';
import { reloadAppData } from '../../state/boot';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

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

  const canManage = roleHas(user.permissions, 'settings.manage');
  const change = async (key: 'autoLockMinutes' | 'blockScreenshots', value: number | boolean) => {
    try {
      if (key === 'autoLockMinutes') await changeSetting(getDb(), key, value as number, { userId: user.id, deviceId: device.id, permissions: user.permissions });
      else await changeSetting(getDb(), key, value as boolean, { userId: user.id, deviceId: device.id, permissions: user.permissions });
      await reloadAppData();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  const setLock = (n: number) => change('autoLockMinutes', n);

  const toggleBio = async (v: boolean) => {
    setErr(null);
    try {
      if (v) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.biometricEnable'), disableDeviceFallback: false, fallbackLabel: t('lock.usePhoneCode') });
        if (!r.success) return;
      }
      await updateUser(getDb(), user, user.id, { biometricEnabled: v }, device);
      setBio(v);
      useApp.getState().set({ user: { ...user, biometricEnabled: v } });
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };

  const shots = useApp((s) => !!s.settings.blockScreenshots);
  const hideNumbers = useApp((s) => !!s.settings.hideSensitive);
  // Personal (this phone only): anyone can switch it, no shop permission needed.
  const setHideNumbers = async (v: boolean) => {
    try {
      await changeSetting(getDb(), 'hideSensitive', v, { userId: user.id, deviceId: device.id });
      await reloadAppData();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  return (
    <Screen back title={t('more.security')}>
      {user.secretKind === 'password' ? (
        <Card onPress={() => router.push('/settings/password')}>
          <View className="flex-row items-center gap-3">
            <IconBadge name="lock" hue="amber" />
            <View className="flex-1">
              <Text variant="subtitle">{t('password.change')}</Text>
              <Text variant="caption">{t('password.changeHint')}</Text>
            </View>
            <Icon name="chevron" size={16} color={colors.ink.faint} />
          </View>
        </Card>
      ) : null}
      {bioAvailable ? (
        <Card>
          <View className="flex-row items-center gap-3">
            <IconBadge name="fingerprint" hue="primary" />
            <View className="flex-1">
              <Text variant="subtitle">{t('security.biometric')}</Text>
              <Text variant="caption">{t('security.biometricHint')}</Text>
            </View>
            <Switch value={bio} onValueChange={(v) => void toggleBio(v)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
          </View>
        </Card>
      ) : null}
      <Card>
        <View className="flex-row items-center gap-3">
          <IconBadge name="shield" hue="sky" />
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">{t('security.screenshots')}</Text>
            <Text variant="caption">{t('security.screenshotsHint')}</Text>
          </View>
          <Switch value={shots} disabled={!canManage} onValueChange={(v) => void change('blockScreenshots', v)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
        </View>
      </Card>
      <Card>
        <View className="flex-row items-center gap-3">
          <IconBadge name="eye" hue="leaf" />
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">{t('security.hideNumbers')}</Text>
            <Text variant="caption">{t('security.hideNumbersHint')}</Text>
          </View>
          <Switch testID="security-hide-numbers" accessibilityLabel={t('security.hideNumbers')} value={hideNumbers} onValueChange={(v) => void setHideNumbers(v)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
        </View>
      </Card>
      <SectionTitle>{t('security.autoLock')}</SectionTitle>
      {!canManage ? <Banner tone="info" icon="lock" text={t('security.managedOnly')} /> : null}
      <View className="flex-row flex-wrap gap-2">
        {OPTIONS.map((n) => (
          <View key={n} style={{ width: '48%', opacity: canManage ? 1 : 0.5 }} pointerEvents={canManage ? 'auto' : 'none'}>
            <Choice compact title={n === 0 ? t('security.never') : t(n >= 3 && n <= 10 ? 'security.minutesFew' : 'security.minutes', { n })} selected={minutes === n} onPress={() => void setLock(n)} />
          </View>
        ))}
      </View>
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
