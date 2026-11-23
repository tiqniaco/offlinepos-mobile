import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as LocalAuthentication from 'expo-local-authentication';
import { OnboardingScreen, Text, Button, TextField, SectionTitle, Card, Banner, IconBadge, colors } from '../../ui';
import { useApp, useOnboarding } from '../../state/app';
import { getDb } from '../../db/client';
import { attachDeviceRemote, createBusinessRemote, finishBusinessLocal } from '../../domain/onboarding';
import { ApiError } from '../../api/client';
import { StepUpCode } from '../../features/auth/StepUpCode';
import { sessionAfterSetup, listActiveUsers, unlockWithBiometric } from '../../domain/auth/users';
import { setBiometric } from '../../domain/auth/biometric';
import { reloadAppData } from '../../state/boot';
import { errorMessage } from '../../lib/errors';

/** Last step: the owner's name, and (optional) fingerprint / face to open the app. The password was set already. */
export default function OwnerScreen() {
  const { t } = useTranslation();
  const draft = useOnboarding();
  const [name, setName] = useState('');
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bio, setBio] = useState(true);
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  // Using an existing shop: an SMS step-up first (the server needs it to move the shop and release its backup key).
  const [stepUp, setStepUp] = useState<'none' | 'asking' | 'done'>('none');

  useEffect(() => {
    void Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]).then(([h, e]) => setBioAvailable(h && e));
  }, []);

  if (!draft.password) {
    // Reached without a password (should not happen): go back and choose one.
    return (
      <OnboardingScreen title={t('owner.title')}>
        <Banner tone="warn" text={t('password.missing')} />
        <Button title={t('password.title')} onPress={() => router.replace('/password')} />
      </OnboardingScreen>
    );
  }

  const finish = async (stepped = stepUp === 'done') => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = t('errors.required');
    setErrors(e);
    if (busy || Object.keys(e).length || !draft.auth || !draft.businessForm || !draft.password) return;
    if (draft.existingBusinessId && !useOnboarding.getState().registration && !stepped) {
      setStepUp('asking');
      return;
    }
    setBusy(true);
    try {
      const db = getDb();
      const owner = { name: name.trim(), password: draft.password };
      // Server part once: on a retry (local step failed) reuse the stored answer instead of creating a second business.
      let reg = useOnboarding.getState().registration;
      if (!reg) {
        reg = draft.existingBusinessId ? await attachDeviceRemote(db, draft.auth, draft.existingBusinessId) : await createBusinessRemote(draft.auth, draft.businessForm);
        useOnboarding.getState().set({ registration: reg });
      }
      await finishBusinessLocal(db, draft.auth, reg, draft.businessForm, owner, !!draft.existingBusinessId);
      await reloadAppData();
      const ownerUser = (await listActiveUsers(db))[0]!;
      let session = await sessionAfterSetup(db, ownerUser.id);
      if (bio && bioAvailable) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('lock.biometricEnable'), disableDeviceFallback: false, cancelLabel: t('common.cancel') });
        if (r.success) {
          await setBiometric(db, session, true);
          session = await unlockWithBiometric(db, ownerUser.id);
        }
      }
      draft.reset();
      useApp.getState().unlock(session);
    } catch (err) {
      // The step-up window (10 min) ran out: ask for a new code.
      if (err instanceof ApiError && err.code === 'step_up_required') setStepUp('asking');
      setErrors({ form: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <OnboardingScreen
      step={4}
      stepLabel={t('onboarding.step', { n: 4, total: 4 })}
      title={t('owner.title')}
      subtitle={t('owner.bodyPassword')}
      footer={stepUp === 'asking' ? undefined : <Button testID="owner-finish" title={busy ? t('owner.creating') : t('owner.finish')} loading={busy} onPress={() => void finish()} />}
    >
      {stepUp === 'asking' && draft.auth ? (
        <StepUpCode
          token={draft.auth.accessToken}
          onCancel={() => setStepUp('none')}
          onVerified={async () => {
            setStepUp('done');
            await finish(true);
          }}
        />
      ) : null}
      <SectionTitle>{t('owner.sectionYou')}</SectionTitle>
      <TextField testID="owner-name" icon="users" label={t('owner.name')} value={name} onChangeText={setName} error={errors.name} latinDigits={false} />
      {bioAvailable ? (
        <Card>
          <View className="flex-row items-center gap-3">
            <IconBadge name="fingerprint" hue="primary" />
            <View className="flex-1">
              <Text variant="subtitle">{t('security.biometric')}</Text>
              <Text variant="caption">{t('owner.bioHint')}</Text>
            </View>
            <Switch value={bio} onValueChange={setBio} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
          </View>
        </Card>
      ) : null}
      <Banner tone="info" icon="lock" text={t('owner.passwordNote')} />
      {errors.form ? <Banner tone="danger" text={errors.form} /> : null}
    </OnboardingScreen>
  );
}
