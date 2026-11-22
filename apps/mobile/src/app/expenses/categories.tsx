import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, TextField, Button, ListGroup, ListRow } from '../../ui';
import { getDb } from '../../db/client';
import { deleteExpenseCategory, listExpenseCategories, saveExpenseCategory } from '../../domain/vouchers/vouchers';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

export default function ExpenseCategories() {
  const { t } = useTranslation();
  const ctx = useBizCtx();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listExpenseCategories>>>([]);
  const [name, setName] = useState('');
  const load = useCallback(() => void listExpenseCategories(getDb()).then(setRows), []);
  useFocusEffect(load);
  const add = async () => {
    if (!ctx || !name.trim()) return;
    try {
      await saveExpenseCategory(ctx, { name });
      setName('');
      load();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  return (
    <Screen back title={t('expenses.categories')}>
      <TextField label={t('expenses.newCat')} value={name} onChangeText={setName} latinDigits={false} onSubmitEditing={() => void add()} />
      <Button compact icon="plus" title={t('common.add')} disabled={!name.trim()} onPress={() => void add()} />
      <ListGroup>
        {rows.map((c, i) => (
          <ListRow
            key={c.id}
            icon="tag"
            hue="rose"
            title={c.name}
            last={i === rows.length - 1}
            onPress={() =>
              Alert.alert(c.name, undefined, [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('common.delete'),
                  style: 'destructive',
                  onPress: () => ctx && void deleteExpenseCategory(ctx, c.id).then(load, (e) => toast(errorMessage(t, e), 'error')),
                },
              ])
            }
          />
        ))}
      </ListGroup>
    </Screen>
  );
}
