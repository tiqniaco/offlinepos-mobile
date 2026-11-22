import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, TextField } from '../../ui';
import { useApp, useOnboarding } from '../../state/app';
import { getDb } from '../../db/client';
import { attachExistingBusiness, createBusinessOnline } from '../../domain/onboarding';
import { isValidPin, isWeakPin, normalizePinInput } from '../../domain/auth/pin';
import { unlockWithPin, listActiveUsers } from '../../domain/auth/users';
import { reloadAppData } from '../../state/boot';
import { errorMessage } from '../../lib/errors';

export default function OwnerScreen() {
  const { t } = useTranslation();
  const draft = useOnboarding();
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [errors, setErrors] = useState<{ name?: string; pin?: string; pin2?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    const e: typeof errors = {};
    if (name.trim().length < 2) e.name = t('errors.required');
    if (!isValidPin(pin)) e.pin = t('owner.pin');
    else if (isWeakPin(pin)) e.pin = t('owner.weak');
    if (pin2 !== pin) e.pin2 = t('owner.mismatch');
    setErrors(e);
    if (Object.keys(e).length || !draft.auth || !draft.businessForm) return;
    setBusy(true);
    try {
      const db = getDb();
      const owner = { name: name.trim(), pin };
      if (draft.existingBusinessId) await attachExistingBusiness(db, draft.auth, draft.existingBusinessId, owner, draft.businessForm.vatNumber);
      else await createBusinessOnline(db, draft.auth, draft.businessForm, owner);
      await reloadAppData();
      // The owner just chose the PIN: sign them in directly.
      const ownerUser = (await listActiveUsers(db))[0]!;
      const session = await unlockWithPin(db, ownerUser.id, pin);
      draft.reset();
      useApp.getState().unlock(session);
    } catch (err) {
      setErrors({ form: errorMessage(t, err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('owner.title')} footer={<Button testID="owner-finish" title={busy ? t('owner.creating') : t('owner.finish')} loading={busy} onPress={finish} />}>
      <Text>{t('owner.body')}</Text>
      <TextField testID="owner-name" label={t('owner.name')} value={name} onChangeText={setName} error={errors.name} latinDigits={false} />
      <TextField
        testID="owner-pin"
        label={t('owner.pin')}
        value={pin}
        onChangeText={(v) => setPin(normalizePinInput(v))}
        keyboardType="number-pad"
        secureTextEntry
        ltr
        error={errors.pin}
      />
      <TextField
        testID="owner-pin2"
        label={t('owner.pinConfirm')}
        value={pin2}
        onChangeText={(v) => setPin2(normalizePinInput(v))}
        keyboardType="number-pad"
        secureTextEntry
        ltr
        error={errors.pin2}
      />
      {errors.form ? <Text className="text-rose-700">{errors.form}</Text> : null}
    </Screen>
  );
}
