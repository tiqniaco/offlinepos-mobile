import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Chip, EmptyState, Fab, colors } from '../../ui';
import { getDb } from '../../db/client';
import { listPurchases } from '../../domain/purchases/purchases';
import { DocRow } from '../../features/common/DocRow';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { AdBanner } from '../../features/ads/AdBanner';
import { money, dateTimeLabel } from '../../lib/format';

export default function Purchases() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const [f, setF] = useState<'all' | 'PURCHASE' | 'PURCHASE_RETURN'>('all');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listPurchases>>>([]);
  useFocusEffect(
    useCallback(() => {
      void listPurchases(getDb(), { types: f === 'all' ? undefined : [f], limit: 200 }).then(setRows);
    }, [f]),
  );
  return (
    <View style={{ flex: 1 }}>
      <Screen back title={t('purchase.listTitle')} scroll={false}>
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
          <Chip label={t('parties.all')} selected={f === 'all'} onPress={() => setF('all')} />
          <Chip label={t('purchase.invoices')} selected={f === 'PURCHASE'} onPress={() => setF('PURCHASE')} />
          <Chip label={t('purchase.returns')} selected={f === 'PURCHASE_RETURN'} onPress={() => setF('PURCHASE_RETURN')} />
        </View>
        {rows.length === 0 ? (
          <EmptyState icon="cart" title={t('purchase.emptyList')} body={t('purchase.emptyListBody')} />
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingBottom: 90 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item }) => (
              <DocRow
                icon={item.type === 'PURCHASE' ? 'cart' : 'refresh'}
                hue={item.type === 'PURCHASE' ? 'primary' : 'amber'}
                title={`${item.number} · ${item.supplierName ?? t('purchase.cashSupplier')}`}
                subtitle={item.postedAt ? dateTimeLabel(i18n.language, item.postedAt) : ''}
                amount={`${item.type === 'PURCHASE_RETURN' ? '−' : ''}${money(item.totalMinor, currency, i18n.language)}`}
                tag={item.status === 'VOIDED' ? t('invoice.voided') : item.creditMinor > 0 ? t('purchase.onCreditTag', { amount: money(item.creditMinor, currency, i18n.language) }) : t('purchase.paidTag')}
                tagColor={item.status === 'VOIDED' ? colors.rose[700] : item.creditMinor > 0 ? colors.amber[700] : colors.leaf[700]}
                voided={item.status === 'VOIDED'}
                onPress={() => router.push({ pathname: '/purchases/[id]', params: { id: item.id } })}
              />
            )}
          />
        )}
      </Screen>
      <AdBanner place="purchases" />
      <Fab testID="purchase-add" onPress={() => router.push('/purchases/new')} />
    </View>
  );
}
