import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, ListGroup, Button, Text, Card } from '../../ui';
import { getDb } from '../../db/client';
import { users as usersTable, roles } from '../../db/schema';
import { eq } from 'drizzle-orm';

type Row = { id: string; name: string; color: string; roleName: string; isActive: boolean };

export default function Users() {
  const { t } = useTranslation();
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
        {rows.map((u) => (
          <Card key={u.id} className="m-0 rounded-none border-0 border-b" onPress={() => router.push({ pathname: '/settings/user-form', params: { id: u.id } })}>
            <View className="flex-row items-center gap-3">
              <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: u.color + '22' }}>
                <Text className="font-bold" style={{ color: u.color }}>
                  {u.name.charAt(0)}
                </Text>
              </View>
              <View className="flex-1">
                <Text variant="subtitle" className={u.isActive ? '' : 'text-ink-faint line-through'}>
                  {u.name}
                </Text>
                <Text variant="caption">{u.roleName}</Text>
              </View>
            </View>
          </Card>
        ))}
      </ListGroup>
    </Screen>
  );
}
