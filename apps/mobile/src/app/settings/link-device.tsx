import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizePhone } from '@daftarak/shared';
import type { AuthResponse } from '@daftarak/shared';
import { Screen, Button, Banner, PhoneField, PasswordField } from '../../ui';
import { fx } from '../../ui/fx';
import { getDb } from '../../db/client';
import { getMeta } from '../../domain/device';
import { ApiError } from '../../api/client';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';
import { useApp } from '../../state/app';
import { reloadAppData } from '../../state/boot';
import { LinkError, finishLinkThisPhone, linkThisPhoneLogin } from '../../features/backup/portable';
import { StepUpCode } from '../../features/auth/StepUpCode';

/** After a restore from a file without internet: once online, link this phone to the account (licence, sign-in). */
export default function LinkDevice() {
  const { t } = useTranslation();
  const [raw, setRaw] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // After the password: an SMS step-up (moving the shop from the old phone and fetching its backup key need it).
  const [signedIn, setSignedIn] = useState<AuthResponse | null>(null);
  useEffect(() => {
    void (async () => setRaw((await getMeta(getDb(), 'account.phone')) ?? (await getMeta(getDb(), 'account_phone')) ?? ''))();
  }, []);

  const submit = async () => {
    if (busy) return;
    const phone = normalizePhone(raw);
    if (!phone) return setErr(t('phone.invalid'));
    if (!password) return setErr(t('login.enterPassword'));
    setErr(null);
    setBusy(true);
    try {
      setSignedIn(await linkThisPhoneLogin(phone, password));
    } catch (e) {
      setErr(e instanceof LinkError ? t('portable.link.notOwner') : e instanceof ApiError && e.code === 'network' ? t('portable.link.offline') : errorMessage(t, e));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  const finish = async (auth: AuthResponse) => {
    setErr(null);
    setBusy(true);
    try {
      await finishLinkThisPhone(auth, password);
      await reloadAppData();
      useApp.getState().set({ restoreUnlinked: false });
      fx.success();
      toast(t('portable.link.done'));
      router.back();
    } catch (e) {
      setErr(e instanceof LinkError ? t('portable.link.notOwner') : e instanceof ApiError && e.code === 'network' ? t('portable.link.offline') : errorMessage(t, e));
      if (!(e instanceof ApiError && e.code === 'network')) setSignedIn(null);
    } finally {
      setBusy(false);
    }
  };

  if (signedIn) {
    return (
      <Screen back title={t('portable.link.title')} subtitle={t('stepUp.title')}>
        <StepUpCode token={signedIn.accessToken} onVerified={() => finish(signedIn)} onCancel={() => setSignedIn(null)} />
        {err ? <Banner tone="danger" text={err} /> : null}
      </Screen>
    );
  }

  return (
    <Screen back title={t('portable.link.title')} subtitle={t('portable.link.body')} footer={<Button testID="link-submit" icon="check" title={t('portable.link.submit')} loading={busy} onPress={() => void submit()} />}>
      <PhoneField value={raw} onChangeText={setRaw} placeholder="01x xxxx xxxx" />
      <PasswordField label={t('login.password')} value={password} onChangeText={setPassword} onSubmitEditing={() => void submit()} />
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
