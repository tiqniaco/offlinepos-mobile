import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { View, Switch, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { roleHas } from '@daftarak/shared';
import { Screen, Text, Choice, SectionTitle, Card, IconBadge, Icon, Banner, MoneyField, colors, type IconName, type Hue } from '../../ui';
import { getDb } from '../../db/client';
import { changeSetting, type AppSettings } from '../../domain/settings/settings';
import { updateUser } from '../../domain/auth/users';
import { resolvePolicy, type ApprovalPolicy } from '../../domain/auth/approval';
import { useApp } from '../../state/app';
import { reloadAppData } from '../../state/boot';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';
import { toast } from '../../state/toast';
import { AUTO_LOCK_OPTIONS, IMMEDIATE } from '../../hooks/autoLockRules';
import { coverEnabled } from '../../features/privacy/coverRules';
import { OwnerReauthGate } from '../../features/lock/OwnerReauthGate';

/** One setting row: icon, title, hint, switch (or any control on the end). */
function Row({ icon, hue, title, hint, value, onChange, disabled, testID, end }: { icon: IconName; hue: Hue; title: string; hint?: string; value?: boolean; onChange?: (v: boolean) => void; disabled?: boolean; testID?: string; end?: ReactNode }) {
  return (
    <Card>
      <View className="flex-row items-center gap-3">
        <IconBadge name={icon} hue={hue} />
        <View style={{ flex: 1 }}>
          <Text variant="subtitle">{title}</Text>
          {hint ? <Text variant="caption">{hint}</Text> : null}
        </View>
        {end ?? <Switch testID={testID} accessibilityLabel={title} value={!!value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />}
      </View>
    </Card>
  );
}

/** Opening needs the owner again (2 minutes, OwnerReauthGate). */
export default function SecurityRoute() {
  const { t } = useTranslation();
  return (
    <OwnerReauthGate title={t('more.security')}>
      <Security />
    </OwnerReauthGate>
  );
}

function Security() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const currency = useApp((s) => s.business?.currency ?? 'EGP');
  const minutes = useApp((s) => s.settings.autoLockMinutes ?? 5);
  const shots = useApp((s) => !!s.settings.blockScreenshots);
  const hideNumbers = useApp((s) => !!s.settings.hideSensitive);
  const cover = useApp((s) => coverEnabled(s.settings.appSwitcherCover));
  const savedPolicy = useApp((s) => s.settings.managerApproval);
  const policy = useMemo(() => resolvePolicy(savedPolicy), [savedPolicy]);
  const [threshold, setThreshold] = useState<number | null>(policy.returnOverMinor);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bio, setBio] = useState(user.biometricEnabled);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => setBioAvailable(h && e));
  }, []);
  useEffect(() => setThreshold(policy.returnOverMinor), [policy.returnOverMinor]);

  const canManage = roleHas(user.permissions, 'settings.manage');
  const ctx = { userId: user.id, deviceId: device.id, permissions: user.permissions };
  const save = async <K extends 'autoLockMinutes' | 'blockScreenshots' | 'appSwitcherCover' | 'hideSensitive' | 'managerApproval'>(key: K, value: AppSettings[K]) => {
    try {
      await changeSetting(getDb(), key, value, ctx);
      await reloadAppData();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  const setPolicy = (patch: Partial<ApprovalPolicy>) => save('managerApproval', { ...policy, ...patch });

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

  const lockLabel = (n: number) => (n === IMMEDIATE ? t('security.immediate') : n === 0 ? t('security.never') : t(n >= 3 && n <= 10 ? 'security.minutesFew' : 'security.minutes', { n }));
  const fmt = (m: number) => money(m, currency, i18n.language);

  return (
    <Screen back title={t('more.security')}>
      {err ? <Banner tone="danger" text={err} /> : null}

      {/* ── فتح التطبيق ── */}
      <SectionTitle>{t('security.sectionOpen')}</SectionTitle>
      {bioAvailable ? <Row icon="fingerprint" hue="primary" title={t('security.biometric')} hint={t('security.biometricHint')} value={bio} onChange={(v) => void toggleBio(v)} /> : null}
      <Text variant="caption">{t('security.autoLock')}</Text>
      <View className="flex-row flex-wrap gap-2" style={{ opacity: canManage ? 1 : 0.5 }} pointerEvents={canManage ? 'auto' : 'none'}>
        {AUTO_LOCK_OPTIONS.map((n) => (
          <View key={n} style={{ width: '48%' }}>
            <Choice compact testID={`autolock-${n}`} title={lockLabel(n)} selected={minutes === n} onPress={() => void save('autoLockMinutes', n)} />
          </View>
        ))}
      </View>

      {/* ── الخصوصية ── */}
      <SectionTitle>{t('security.sectionPrivacy')}</SectionTitle>
      {/* Personal (this phone only): anyone can switch it, no shop permission needed. */}
      <Row icon="eye" hue="leaf" testID="security-hide-numbers" title={t('security.hideNumbers')} hint={t('security.hideNumbersHint')} value={hideNumbers} onChange={(v) => void save('hideSensitive', v)} />
      <Row icon="shield" hue="sky" title={t('security.screenshots')} hint={t('security.screenshotsHint')} value={shots} disabled={!canManage} onChange={(v) => void save('blockScreenshots', v)} />
      <Row icon="lock" hue="ink" testID="security-cover" title={t('security.cover')} hint={Platform.OS === 'android' ? t('security.coverHintAndroid') : t('security.coverHint')} value={cover} disabled={!canManage} onChange={(v) => void save('appSwitcherCover', v)} />

      {/* ── تأكيد المدير ── */}
      <SectionTitle>{t('approval.section')}</SectionTitle>
      <Text variant="caption">{t('approval.intro')}</Text>
      <Row icon="trash" hue="rose" testID="approval-void" title={t('approval.void')} hint={t('approval.voidHint')} value={policy.void} disabled={!canManage} onChange={(v) => void setPolicy({ void: v })} />
      <Card>
        <View style={{ gap: 10 }}>
          <View className="flex-row items-center gap-3">
            <IconBadge name="refresh" hue="amber" />
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{t('approval.returnOver')}</Text>
              <Text variant="caption">{t('approval.returnOverHint', { amount: fmt(policy.returnOverMinor) })}</Text>
            </View>
            <Switch testID="approval-return" accessibilityLabel={t('approval.returnOver')} value={policy.returnOver} disabled={!canManage} onValueChange={(v) => void setPolicy({ returnOver: v })} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
          </View>
          {policy.returnOver ? (
            <MoneyField
              label={t('approval.threshold')}
              valueMinor={threshold}
              onValue={setThreshold}
              editable={canManage}
              onEndEditing={() => {
                if (threshold != null && threshold >= 0 && threshold !== policy.returnOverMinor) void setPolicy({ returnOverMinor: threshold });
                else setThreshold(policy.returnOverMinor);
              }}
            />
          ) : null}
        </View>
      </Card>
      <Row icon="box" hue="rose" testID="approval-product-delete" title={t('approval.productDelete')} value={policy.productDelete} disabled={!canManage} onChange={(v) => void setPolicy({ productDelete: v })} />
      <Row icon="tag" hue="amber" testID="approval-price" title={t('approval.priceChange')} hint={t('approval.priceChangeHint')} value={policy.priceChange} disabled={!canManage} onChange={(v) => void setPolicy({ priceChange: v })} />
      <Row icon="download" hue="sky" testID="approval-export" title={t('approval.exportData')} hint={t('approval.exportDataHint')} value={policy.exportData} disabled={!canManage} onChange={(v) => void setPolicy({ exportData: v })} />
      <Row icon="cash" hue="leaf" title={t('approval.discount')} hint={t('approval.discountHint')} end={<Text variant="caption">{t('approval.always')}</Text>} />
      {!canManage ? <Banner tone="info" icon="lock" text={t('security.managedOnly')} /> : null}

      {/* ── الحساب ── */}
      <SectionTitle>{t('security.sectionAccount')}</SectionTitle>
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
      {roleHas(user.permissions, 'users.manage') ? (
        <Card onPress={() => router.push('/settings/devices')}>
          <View className="flex-row items-center gap-3">
            <IconBadge name="eye" hue="primary" />
            <View className="flex-1">
              <Text variant="subtitle">{t('more.devices')}</Text>
              <Text variant="caption">{t('devices.subtitle')}</Text>
            </View>
            <Icon name="chevron" size={16} color={colors.ink.faint} />
          </View>
        </Card>
      ) : null}
      {roleHas(user.permissions, 'users.manage') ? (
        <Card onPress={() => router.push('/settings/sessions')}>
          <View className="flex-row items-center gap-3">
            <IconBadge name="phone" hue="sky" />
            <View className="flex-1">
              <Text variant="subtitle">{t('more.sessions')}</Text>
              <Text variant="caption">{t('security.sessionsHint')}</Text>
            </View>
            <Icon name="chevron" size={16} color={colors.ink.faint} />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
