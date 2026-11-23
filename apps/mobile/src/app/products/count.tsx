import { useCallback, useEffect, useState } from 'react';
import { fonts } from '../../ui/fonts';
import { Alert, TextInput, View, Platform } from 'react-native';
import { Pressable } from '../../ui/Press';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizeBarcode, normalizeDigits } from '@daftarak/shared';
import { Screen, Text, Button, Card, Icon, Sheet, QtyField, EmptyState, colors, shadow } from '../../ui';
import { getDb } from '../../db/client';
import { countItem, countLines, discardCount, openCount, postCount, removeCountItem, type CountLine } from '../../domain/inventory/adjust';
import { findByBarcode } from '../../domain/inventory/products';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';
import { useScanner } from '../../state/scanner';
import { fx } from '../../ui/fx';
import { toast } from '../../state/toast';
import { qty } from '../../lib/format';

/** Scan-driven stock count (جرد): every scan adds one (or one carton when the carton barcode is scanned). */
export default function StockCount() {
  const { t } = useTranslation();
  const ctx = useInvCtx();
  const [docId, setDocId] = useState<string | null>(null);
  const [lines, setLines] = useState<CountLine[]>([]);
  const [code, setCode] = useState('');
  const [edit, setEdit] = useState<CountLine | null>(null);
  const [editQty, setEditQty] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (id: string) => setLines(await countLines(getDb(), id)), []);
  useEffect(() => {
    if (!ctx) return;
    void openCount(ctx).then((id) => {
      setDocId(id);
      void reload(id);
    }, (e) => toast(invErrorMessage(t, e), 'error'));
  }, [ctx, reload, t]);

  const handleCode = useCallback(
    async (raw: string): Promise<string | null> => {
      if (!ctx || !docId) return null;
      const hit = await findByBarcode(getDb(), raw);
      if (!hit) {
        fx.notFound();
        return t('count.notFound');
      }
      fx.scan();
      await countItem(ctx, docId, hit.productId, hit.factorMilli, 'add');
      const ls = await countLines(getDb(), docId);
      setLines(ls);
      const l = ls.find((x) => x.productId === hit.productId);
      return l ? `${l.name}: ${qty(l.countedMilli)}` : null;
    },
    [ctx, docId, t],
  );

  const post = () =>
    Alert.alert(t('count.post'), t('count.confirmPost', { n: lines.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('count.post'),
        onPress: async () => {
          if (!ctx || !docId) return;
          setBusy(true);
          try {
            const r = await postCount(ctx, docId);
            toast(t('count.posted', { number: r.number, n: r.changed }));
            router.back();
          } catch (e) {
            toast(invErrorMessage(t, e), 'error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <Screen
      back
      title={t('count.title')}
      subtitle={lines.length ? t('count.items', { n: lines.length }) : undefined}
      right={docId && lines.length ? <Button compact kind="ghost" title={t('count.discard')} onPress={() => ctx && void discardCount(ctx, docId).then(() => router.back())} /> : undefined}
      footer={<Button testID="count-post" title={t('count.post')} loading={busy} disabled={!lines.length} onPress={post} />}
    >
      <Card>
        <View style={{ gap: 12 }}>
          <Text variant="caption">{t('count.intro')}</Text>
          <Button
            icon="scan"
            title={t('count.scan')}
            onPress={() => {
              useScanner.getState().set({ continuous: true, onCode: handleCode });
              router.push('/scan');
            }}
          />
          {/* Hardware scanners type here and press Enter. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 50, borderRadius: 14, borderWidth: 2, borderColor: colors.paper.line, paddingHorizontal: 12, backgroundColor: colors.paper.DEFAULT }}>
            <Icon name="scan" color={colors.ink.faint} size={20} />
            <TextInput
              testID="count-input"
              value={code}
              onChangeText={(v) => setCode(normalizeDigits(v))}
              onSubmitEditing={async () => {
                const c = normalizeBarcode(code);
                setCode('');
                if (!c) return;
                const msg = await handleCode(c);
                if (msg) toast(msg, msg === t('count.notFound') ? 'error' : 'success');
              }}
              blurOnSubmit={false}
              placeholder={t('productForm.barcodePh')}
              placeholderTextColor={colors.ink.faint}
              style={[{ flex: 1, minWidth: 0, fontSize: 16, color: colors.ink.DEFAULT, textAlign: 'left', fontFamily: fonts.medium }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
            />
          </View>
        </View>
      </Card>
      {lines.length === 0 ? (
        <EmptyState icon="clipboard" hue="sky" title={t('count.empty')} />
      ) : (
        lines.map((l) => {
          const diff = l.countedMilli - l.expectedMilli;
          return (
            <Pressable key={l.productId} onPress={() => { setEdit(l); setEditQty(l.countedMilli); }} style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.paper.card }, shadow.soft]}>
              <View style={{ flex: 1 }}>
                <Text variant="subtitle">{l.name}{l.variantLabel ? ` · ${l.variantLabel}` : ''}</Text>
                <Text variant="caption">{t('count.system')}: {qty(l.expectedMilli)} {l.unitName}</Text>
              </View>
              <View style={{ alignItems: 'center', minWidth: 64 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 20, lineHeight: 28, color: colors.ink.DEFAULT }}>{qty(l.countedMilli)}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 18, color: diff === 0 ? colors.leaf[700] : diff > 0 ? colors.sky[700] : colors.rose[700] }}>
                  {diff === 0 ? '✓' : `${diff > 0 ? '+' : ''}${qty(diff)}`}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}
      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name}
        footer={
          <>
            <Button
              title={t('common.save')}
              onPress={async () => {
                if (!ctx || !docId || !edit) return;
                await countItem(ctx, docId, edit.productId, editQty ?? 0, 'set');
                setEdit(null);
                void reload(docId);
              }}
            />
            <Button kind="danger" icon="trash" title={t('common.cancel')} onPress={async () => { if (ctx && docId && edit) { await removeCountItem(ctx, docId, edit.productId); setEdit(null); void reload(docId); } }} />
          </>
        }
      >
        <QtyField label={t('count.setQty')} valueMilli={editQty} onValue={setEditQty} autoFocus />
      </Sheet>
    </Screen>
  );
}
