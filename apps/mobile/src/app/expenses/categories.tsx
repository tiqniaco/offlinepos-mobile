import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas, validateNameRows } from '@daftarak/shared';
import { Screen, TextField, Button, ListGroup, ListRow, Sheet, Text, Chip } from '../../ui';
import { getDb } from '../../db/client';
import { deleteExpenseCategory, importExpenseCategories, listExpenseCategories, saveExpenseCategory } from '../../domain/vouchers/vouchers';
import { isCashierPhone } from '../../domain/sync/role';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { pickSpreadsheet, shareWorkbook } from '../../features/inventory/excel';
import { useApp } from '../../state/app';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

type Preview = ReturnType<typeof validateNameRows>;

export default function ExpenseCategories() {
  const { t } = useTranslation();
  const ctx = useBizCtx();
  const canImport = useApp((s) => !!s.user && roleHas(s.user.permissions, 'expenses.manage')) && !isCashierPhone();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listExpenseCategories>>>([]);
  const [name, setName] = useState('');
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
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
  const closeImport = () => {
    if (busy) return;
    setImporting(false);
    setPreview(null);
  };
  const pick = async () => {
    setBusy(true);
    try {
      const s = await pickSpreadsheet();
      if (s) setPreview(validateNameRows(s.rows, rows.map((r) => r.name)));
    } catch {
      toast(t('importer.readError'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!ctx || !preview?.names.length) return;
    setBusy(true);
    try {
      const r = await importExpenseCategories(ctx, preview.names);
      toast(t('categoryImport.done', { n: r.created }));
      load();
      setImporting(false);
      setPreview(null);
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen back title={t('expenses.categories')} right={canImport ? <Button compact kind="secondary" icon="upload" title={t('categoryImport.button')} testID="expcat-import" onPress={() => setImporting(true)} /> : null}>
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
      <Sheet visible={importing} onClose={closeImport} title={t('categoryImport.title')}>
        <View style={{ gap: 12 }}>
          {!preview ? (
            <>
              <Text variant="caption">{t('categoryImport.body')}</Text>
              <Button kind="secondary" icon="download" title={t('importer.template')} onPress={() => void shareWorkbook([[t('importer.fields.name')], ...rows.slice(0, 3).map((r) => [r.name])], 'kashiro-expense-types-template.xlsx', t('expenses.categories')).catch((e: unknown) => toast(errorMessage(t, e), 'error'))} />
              <Button icon="upload" title={busy ? t('common.loading') : t('importer.pick')} loading={busy} onPress={() => void pick()} />
            </>
          ) : (
            <>
              <Text variant="subtitle">{preview.names.length ? t('categoryImport.newN', { n: preview.names.length }) : t('categoryImport.none')}</Text>
              {preview.existing ? <Text variant="caption">{t('categoryImport.existing', { n: preview.existing })}</Text> : null}
              {preview.duplicates ? <Text variant="caption">{t('categoryImport.duplicates', { n: preview.duplicates })}</Text> : null}
              {preview.tooLong.length ? <Text variant="caption">{t('categoryImport.tooLong', { rows: preview.tooLong.slice(0, 20).join('، ') })}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {preview.names.slice(0, 40).map((n) => (
                  <Chip key={n} label={n} />
                ))}
              </View>
              <Button testID="expcat-import-run" icon="check" title={t('categoryImport.run', { n: preview.names.length })} disabled={!preview.names.length || !ctx} loading={busy} onPress={() => void run()} />
            </>
          )}
        </View>
      </Sheet>
    </Screen>
  );
}
