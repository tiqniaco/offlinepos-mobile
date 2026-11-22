import { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Screen, Text, Button, TextField, Choice, colors } from '../../ui';
import { getDb } from '../../db/client';
import { users } from '../../db/schema';
import { addUser, listRoles, updateUser, type RoleRow } from '../../domain/auth/users';
import { isValidPin, isWeakPin, normalizePinInput } from '../../domain/auth/pin';
import { useApp } from '../../state/app';
import { errorMessage } from '../../lib/errors';

export default function UserForm() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const actor = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = getDb();
    void listRoles(db).then((r) => {
      setRoles(r);
      if (!id) setRoleId(r.find((x) => x.key === 'cashier')?.id ?? r[0]?.id ?? null);
    });
    if (id) {
      void db.select().from(users).where(eq(users.id, id)).limit(1).then(([u]) => {
        if (!u) return;
        setName(u.name);
        setRoleId(u.roleId);
        setActive(u.isActive);
      });
    }
  }, [id]);

  const save = async () => {
    setErr(null);
    if (name.trim().length < 2 || !roleId) return setErr(t('errors.required'));
    if ((!id || pin) && (!isValidPin(pin) || isWeakPin(pin))) return setErr(isValidPin(pin) ? t('owner.weak') : t('owner.pin'));
    setBusy(true);
    try {
      const db = getDb();
      if (id) await updateUser(db, actor, id, { name, roleId, isActive: active, ...(pin ? { pin } : {}) }, device);
      else await addUser(db, actor, { name, pin, roleId }, device);
      router.back();
    } catch (e) {
      setErr((e as Error).message === 'last_owner' ? t('users.lastOwner') : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={id ? name : t('users.add')} footer={<Button testID="user-save" title={t('common.save')} loading={busy} onPress={save} />}>
      <TextField testID="user-name" label={t('users.name')} value={name} onChangeText={setName} latinDigits={false} />
      <Text variant="label">{t('users.role')}</Text>
      <View className="gap-2">
        {roles.map((r) => (
          <Choice key={r.id} testID={`role-${r.key}`} title={r.name} selected={roleId === r.id} onPress={() => setRoleId(r.id)} />
        ))}
      </View>
      <TextField
        testID="user-pin"
        label={id ? t('users.changePin') : t('users.pin')}
        value={pin}
        onChangeText={(v) => setPin(normalizePinInput(v))}
        keyboardType="number-pad"
        secureTextEntry
        ltr
      />
      {id && id !== actor.id ? (
        <View className="flex-row items-center justify-between rounded-card bg-paper-card px-4 py-3">
          <Text variant="subtitle">{active ? t('users.disable') : t('users.enable')}</Text>
          <Switch value={!active} onValueChange={(v) => setActive(!v)} trackColor={{ true: colors.rose[500], false: colors.paper.line }} />
        </View>
      ) : null}
      {err ? <Text className="text-rose-700">{err}</Text> : null}
    </Screen>
  );
}
