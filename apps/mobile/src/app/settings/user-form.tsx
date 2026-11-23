import { useEffect, useState } from 'react';
import { View, Switch } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Screen, Text, Button, TextField, Choice, SectionTitle, Card, Banner, colors } from '../../ui';
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
  /** Role the user had when the form opened (the owner keeps seeing «المالك»; staff are never offered it). */
  const [origRoleId, setOrigRoleId] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [active, setActive] = useState(true);
  const [secretKind, setSecretKind] = useState<'pin' | 'password'>('pin');
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
        setOrigRoleId(u.roleId);
        setActive(u.isActive);
        setSecretKind(u.secretKind);
      });
    }
  }, [id]);

  const save = async () => {
    setErr(null);
    if (name.trim().length < 2 || !roleId) return setErr(t('errors.required'));
    const usesPin = secretKind !== 'password';
    if (usesPin && (!id || pin) && (!isValidPin(pin) || isWeakPin(pin))) return setErr(isValidPin(pin) ? t('owner.weak') : t('owner.pin'));
    setBusy(true);
    try {
      const db = getDb();
      if (id) await updateUser(db, actor, id, { name, roleId, isActive: active, ...(pin && usesPin ? { pin } : {}) }, device);
      else await addUser(db, actor, { name, pin, roleId }, device);
      router.back();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m === 'last_owner' ? t('users.lastOwner') : m === 'password_user' ? t('users.passwordUser') : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={id ? name : t('users.add')} footer={<Button testID="user-save" title={t('common.save')} loading={busy} onPress={save} />}>
      <TextField testID="user-name" icon="users" label={t('users.name')} value={name} onChangeText={setName} latinDigits={false} />
      <SectionTitle>{t('users.role')}</SectionTitle>
      <View className="gap-2">
        {roles
          .filter((r) => r.key !== 'owner' || (!!id && r.id === origRoleId))
          .map((r) => (
          <Choice
            key={r.id}
            testID={`role-${r.key}`}
            icon={r.key === 'owner' ? 'shield' : r.key === 'manager' ? 'users' : 'card'}
            hue={r.key === 'owner' ? 'primary' : r.key === 'manager' ? 'sky' : 'amber'}
            title={r.name}
            hint={r.key && ['owner', 'manager', 'cashier'].includes(r.key) ? t(`users.roleHint.${r.key}`) : undefined}
            selected={roleId === r.id}
            onPress={() => setRoleId(r.id)}
          />
        ))}
      </View>
      {secretKind === 'password' ? (
        <>
          <SectionTitle>{t('login.password')}</SectionTitle>
          <Banner tone="info" icon="lock" text={t('users.passwordUser')} />
          {id === actor.id ? <Button kind="ghost" compact title={t('users.changePassword')} onPress={() => router.push('/settings/password')} /> : null}
        </>
      ) : (
        <>
          <TextField
            icon="lock"
            testID="user-pin"
            label={id ? t('users.changePin') : t('users.pin')}
            value={pin}
            onChangeText={(v) => setPin(normalizePinInput(v))}
            keyboardType="number-pad"
            secureTextEntry
            ltr
          />
        </>
      )}
      {id && id !== actor.id ? (
        <Card>
          <View className="flex-row items-center justify-between">
            <Text variant="subtitle">{active ? t('users.disable') : t('users.enable')}</Text>
            <Switch value={!active} onValueChange={(v) => setActive(!v)} trackColor={{ true: colors.rose[500], false: colors.paper.line }} />
          </View>
        </Card>
      ) : null}
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
