import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, ListGroup, ListRow, Button, Sheet, TextField, EmptyState, colors } from '../../ui';
import { getDb } from '../../db/client';
import { deleteCategory, listCategories, saveCategory, CATEGORY_COLORS } from '../../domain/inventory/catalog';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';
import { toast } from '../../state/toast';
import { Pressable } from '../../ui/Press';

type Cat = Awaited<ReturnType<typeof listCategories>>[number];

export default function Categories() {
  const { t } = useTranslation();
  const ctx = useInvCtx();
  const [rows, setRows] = useState<Cat[]>([]);
  const [edit, setEdit] = useState<{ id?: string; name: string; color: string | null } | null>(null);
  const load = useCallback(() => void listCategories(getDb()).then(setRows), []);
  useFocusEffect(load);

  const save = async () => {
    if (!ctx || !edit) return;
    try {
      await saveCategory(ctx, edit);
      setEdit(null);
      load();
    } catch (e) {
      toast(invErrorMessage(t, e), 'error');
    }
  };

  return (
    <Screen back title={t('categories.title')} footer={<Button icon="plus" title={t('categories.add')} onPress={() => setEdit({ name: '', color: null })} />}>
      {rows.length === 0 ? (
        <EmptyState icon="layers" hue="amber" title={t('categories.title')} body={t('categories.empty')} />
      ) : (
        <ListGroup>
          {rows.map((c, i) => (
            <ListRow
              key={c.id}
              leading={<View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: (c.color ?? colors.primary[500]) + '22', alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: c.color ?? colors.primary[500] }} /></View>}
              title={c.name}
              value={t('categories.products', { n: Number(c.products) })}
              onPress={() => setEdit({ id: c.id, name: c.name, color: c.color })}
              last={i === rows.length - 1}
            />
          ))}
        </ListGroup>
      )}
      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.id ? edit.name : t('categories.add')}
        footer={
          <>
            <Button title={t('common.save')} onPress={save} />
            {edit?.id ? (
              <Button
                kind="danger"
                icon="trash"
                title={t('categories.delete')}
                onPress={() =>
                  Alert.alert(t('categories.delete'), t('categories.deleteHint'), [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('categories.delete'), style: 'destructive', onPress: () => ctx && edit.id && void deleteCategory(ctx, edit.id).then(() => { setEdit(null); load(); }) },
                  ])
                }
              />
            ) : null}
          </>
        }
      >
        <TextField label={t('categories.name')} value={edit?.name ?? ''} onChangeText={(v) => edit && setEdit({ ...edit, name: v })} latinDigits={false} autoFocus />
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
          {CATEGORY_COLORS.map((c) => (
            <Pressable key={c} onPress={() => edit && setEdit({ ...edit, color: c })} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: c, borderWidth: 3, borderColor: edit?.color === c ? colors.ink.DEFAULT : 'transparent' }} />
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}
