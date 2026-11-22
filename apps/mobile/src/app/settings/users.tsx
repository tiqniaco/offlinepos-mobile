import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { eq } from 'drizzle-orm';
import { Screen, ListGroup, ListRow, Button, Avatar, Card, IconBadge, Text, colors } from '../../ui';
import { getDb } from '../../db/client';
import { users as usersTable, roles } from '../../db/schema';
import { useApp } from '../../state/app';

type Row = { id: string; name: string; color: string; roleName: string; isActive: boolean };

export default function Users() {
  const { t } = useTranslation();
  const me = useApp((s) => s.user);
  const [rows, setRows] = useState<Row[]>([]);
  useFocusEffect(
    useCallback(() => {
      void getDb()
        .select({ id: usersTable.id, name: usersTable.name, color: usersTable.color, roleName: roles.name, isActive: usersTable.isActive })
        .from(usersTable)
        .innerJoin(roles, eq(roles.id, usersTable.roleId))
        .then(setRows);
    }, []),
  );
  return (
    <Screen back title={t('users.title')} footer={<Button testID="user-add" icon="plus" title={t('users.add')} onPress={() => router.push('/settings/user-form')} />}>
      <ListGroup>
        {rows.map((u, i) => (
          <ListRow
            key={u.id}
            leading={<Avatar name={u.name} color={u.isActive ? u.color : colors.ink.faint} size={42} />}
            title={u.id === me?.id ? `${u.name} (${t('users.you')})` : u.name}
            subtitle={u.isActive ? u.roleName : `${u.roleName} · ${t('users.disabled')}`}
            onPress={() => router.push({ pathname: '/settings/user-form', params: { id: u.id } })}
            last={i === rows.length - 1}
          />
        ))}
      </ListGroup>
      {rows.length <= 1 ? (
        <Card>
          <View className="items-center gap-2 py-3">
            <IconBadge name="users" hue="amber" size={56} />
            <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{t('users.empty')}</Text>
            <Text variant="caption" className="text-center">
              {t('users.emptyHint')}
            </Text>
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
