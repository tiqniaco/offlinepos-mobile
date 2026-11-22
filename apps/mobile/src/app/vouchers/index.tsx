import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Chip, EmptyState, Fab, colors } from '../../ui';
import { getDb } from '../../db/client';
import { listVouchers, type VoucherType } from '../../domain/vouchers/vouchers';
import { DocRow } from '../../features/common/DocRow';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, dateTimeLabel } from '../../lib/format';

const FILTERS: { key: string; types?: VoucherType[] }[] = [
  { key: 'all' },
  { key: 'in', types: ['RECEIPT', 'SUPPLIER_REFUND', 'CASH_IN'] },
  { key: 'out', types: ['PAYMENT', 'CUSTOMER_REFUND', 'EXPENSE', 'CASH_OUT'] },
  { key: 'opening', types: ['OPENING_BALANCE'] },
];
const IN: VoucherType[] = ['RECEIPT', 'SUPPLIER_REFUND', 'CASH_IN'];

/** All money documents (سندات القبض والصرف). */
export default function Vouchers() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const [f, setF] = useState('all');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listVouchers>>>([]);
  useFocusEffect(
    useCallback(() => {
      void listVouchers(getDb(), { types: FILTERS.find((x) => x.key === f)?.types, limit: 200 }).then(setRows);
    }, [f]),
  );
  return (
    <Screen back title={t('voucher.listTitle')} scroll={false}>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {FILTERS.map((x) => (
          <Chip key={x.key} label={t(`voucher.filter.${x.key}`)} selected={f === x.key} onPress={() => setF(x.key)} />
        ))}
      </View>
      {rows.length === 0 ? (
        <EmptyState icon="receipt" hue="sky" title={t('voucher.empty')} />
      ) : (
        <FlashList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingBottom: 90 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            const inflow = IN.includes(item.type);
            return (
              <DocRow
                icon={inflow ? 'arrowIn' : 'arrowOut'}
                hue={inflow ? 'leaf' : 'amber'}
                title={`${t(`voucher.title.${item.type}`)} · ${item.partyName ?? item.categoryName ?? ''}`}
                subtitle={`${item.number} · ${dateTimeLabel(i18n.language, item.postedAt)}`}
                amount={`${inflow ? '+' : item.type === 'OPENING_BALANCE' ? '' : '−'}${money(item.amountMinor, currency, i18n.language)}`}
                amountColor={inflow ? colors.leaf[700] : item.type === 'OPENING_BALANCE' ? colors.ink.DEFAULT : colors.rose[700]}
                tag={item.status === 'VOIDED' ? t('invoice.voided') : t(`pay.methods.${item.method}`)}
                tagColor={item.status === 'VOIDED' ? colors.rose[700] : undefined}
                voided={item.status === 'VOIDED'}
                onPress={() => router.push({ pathname: '/vouchers/[id]', params: { id: item.id } })}
              />
            );
          }}
        />
      )}
      <Fab onPress={() => router.push({ pathname: '/vouchers/new', params: { type: 'RECEIPT' } })} />
    </Screen>
  );
}
