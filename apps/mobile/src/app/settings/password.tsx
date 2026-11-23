import { useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { passwordProblem } from '@daftarak/shared';
import { Screen, Button, PasswordField, Banner } from '../../ui';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { getDb } from '../../db/client';
import { syncOwnerPassword } from '../../domain/auth/users';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { fx } from '../../ui/fx';

/** Owner: change the account password (needs internet). Other phones are signed out; this one keeps working. */
export default function ChangePassword() {
  const { t } = useTranslation();
  const device = useApp((s) => s.device)!;
  const [cur, setCur] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const p = passwordProblem(pw);
    if (!cur) return setErr(t('login.enterPassword'));
    if (p) return setErr(t(`password.problem.${p}`));
    if (pw !== pw2) return setErr(t('owner.mismatch'));
    setErr(null);
    setBusy(true);
    try {
      await api.setPassword(await accessToken(), pw, cur);
      await syncOwnerPassword(getDb(), pw, device.id);
      fx.success();
      toast(t('password.changed'));
      router.back();
    } catch (e) {
      setErr(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('password.change')} subtitle={t('password.changeBody')}>
      <PasswordField label={t('password.current')} value={cur} onChangeText={setCur} autoFocus />
      <PasswordField label={t('password.new')} value={pw} onChangeText={setPw} />
      <PasswordField label={t('password.confirm')} value={pw2} onChangeText={setPw2} onSubmitEditing={() => void save()} />
      <Banner tone="info" icon="shield" text={t('password.otherPhones')} />
      {err ? <Banner tone="danger" text={err} /> : null}
      <Button title={t('password.save')} loading={busy} onPress={() => void save()} />
    </Screen>
  );
}
