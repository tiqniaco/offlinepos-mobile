import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

const PAGE = 50;

export default function Purchases() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const [f, setF] = useState<'all' | 'PURCHASE' | 'PURCHASE_RETURN'>('all');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listPurchases>>>([]);
  const [loading, setLoading] = useState(true);
  const req = useRef(0);
  const more = useRef({ busy: false, done: false });
  useFocusEffect(
    useCallback(() => {
      const my = ++req.current;
      more.current = { busy: false, done: false };
      setLoading(true);
      listPurchases(getDb(), { types: f === 'all' ? undefined : [f], limit: PAGE })
        .then((r) => {
          if (my !== req.current) return;
          setRows(r);
          more.current.done = r.length < PAGE;
        })
        .catch((e: unknown) => my === req.current && toast(errorMessage(t, e), 'error'))
        .finally(() => my === req.current && setLoading(false));
    }, [f, t]),
  );
  const loadMore = () => {
    const m = more.current;
    if (m.busy || m.done || loading) return;
    m.busy = true;
    const my = req.current;
    listPurchases(getDb(), { types: f === 'all' ? undefined : [f], limit: PAGE, offset: rows.length })
      .then((r) => {
        if (my !== req.current) return;
        if (r.length < PAGE) m.done = true;
        setRows((cur) => {
          const seen = new Set(cur.map((x) => x.id));
          return [...cur, ...r.filter((x) => !seen.has(x.id))];
        });
      })
      .catch((e: unknown) => my === req.current && toast(errorMessage(t, e), 'error'))
      .finally(() => {
        m.busy = false;
      });
  };
  return (
    <View style={{ flex: 1 }}>
      <Screen back title={t('purchase.listTitle')} scroll={false}>
        <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
          <Chip label={t('parties.all')} selected={f === 'all'} onPress={() => setF('all')} />
          <Chip label={t('purchase.invoices')} selected={f === 'PURCHASE'} onPress={() => setF('PURCHASE')} />
          <Chip label={t('purchase.returns')} selected={f === 'PURCHASE_RETURN'} onPress={() => setF('PURCHASE_RETURN')} />
        </View>
        {loading && rows.length === 0 ? (
          <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 32 }} />
        ) : rows.length === 0 ? (
          <EmptyState icon="cart" title={t('purchase.emptyList')} body={t('purchase.emptyListBody')} />
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(r) => r.id}
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            contentContainerStyle={{ paddingBottom: 90 }}
            // The ad sits at the TOP of the list, far from the floating + (no accidental taps).
            ListHeaderComponent={<AdBanner place="purchases" inList />}
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
      <Fab testID="purchase-add" onPress={() => router.push('/purchases/new')} />
    </View>
  );
}
