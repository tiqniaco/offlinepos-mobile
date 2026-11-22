import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { addVariant, deleteProduct, restoreProduct } from '../../domain/inventory/products';
import { loadDetail } from '../../features/inventory/loadDetail';
import { ProductDetailView, type DetailData } from '../../features/inventory/ProductDetailView';
import { useCan, useCurrency, useInvCtx } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';
import { toast } from '../../state/toast';
import { Sheet, TextField, Button } from '../../ui';

export default function ProductScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useInvCtx();
  const currency = useCurrency();
  const canManage = useCan('products.manage');
  const canAdjust = useCan('stock.adjust');
  const canSeeCost = useCan('cost.view');
  const [d, setD] = useState<DetailData | null>(null);
  const [variant, setVariant] = useState<{ label: string; current: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadDetail(id).then(setD);
    }, [id]),
  );
  if (!d) return null;

  const remove = () =>
    Alert.alert(t('product.delete'), t('product.deleteConfirm', { name: d.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('product.delete'),
        style: 'destructive',
        onPress: async () => {
          if (!ctx) return;
          try {
            await deleteProduct(ctx, id);
            router.back();
            toast(t('products.deleted', { name: d.name }), 'info', {
              label: t('products.undo'),
              onPress: () =>
                void restoreProduct(ctx, id).then(
                  () => toast(t('products.restored')),
                  (e) => toast(invErrorMessage(t, e), 'error'),
                ),
            });
          } catch (e) {
            toast(invErrorMessage(t, e), 'error');
          }
        },
      },
    ]);

  return (
    <>
      <ProductDetailView
        id={id}
        d={d}
        currency={currency}
        lang={i18n.language}
        canManage={canManage}
        canAdjust={canAdjust}
        canSeeCost={canSeeCost}
        onAdjust={() => router.push({ pathname: '/products/adjust', params: { id } })}
        onMovements={() => router.push({ pathname: '/reports/movement', params: { id } })}
        onEdit={() => router.push({ pathname: '/products/form', params: { id } })}
        onAddVariant={() => setVariant({ label: '', current: d.variantLabel ?? '' })}
        onDelete={remove}
      />
      <Sheet
        visible={!!variant}
        onClose={() => setVariant(null)}
        title={t('product.addVariant')}
        footer={
          <Button
            title={t('common.save')}
            onPress={async () => {
              if (!ctx || !variant) return;
              try {
                const newId = await addVariant(ctx, id, variant.label, variant.current || undefined);
                setVariant(null);
                router.push({ pathname: '/products/form', params: { id: newId } });
              } catch (e) {
                toast(invErrorMessage(t, e), 'error');
              }
            }}
          />
        }
      >
        {variant && !d.variantLabel ? <TextField label={t('product.currentVariant')} placeholder="M" value={variant.current} onChangeText={(v) => setVariant({ ...variant, current: v })} latinDigits={false} /> : null}
        <TextField label={t('product.variantName')} placeholder={t('product.variantPh')} value={variant?.label ?? ''} onChangeText={(v) => variant && setVariant({ ...variant, label: v })} latinDigits={false} autoFocus />
      </Sheet>
    </>
  );
}
