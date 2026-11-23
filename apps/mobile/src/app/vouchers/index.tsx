import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas } from '@daftarak/shared';
import { Screen, Chip, EmptyState, Fab, Sheet, ListGroup, ListRow, colors } from '../../ui';
import { useApp } from '../../state/app';
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
const PAGE = 50;
/** What the + button can create, each behind the permission the domain checks. */
const NEW_TYPES: { type: VoucherType; perm: 'parties.manage' | 'purchases.manage'; icon: 'arrowIn' | 'arrowOut'; hue: 'leaf' | 'amber' }[] = [
  { type: 'RECEIPT', perm: 'parties.manage', icon: 'arrowIn', hue: 'leaf' },
  { type: 'PAYMENT', perm: 'purchases.manage', icon: 'arrowOut', hue: 'amber' },
  { type: 'CUSTOMER_REFUND', perm: 'parties.manage', icon: 'arrowOut', hue: 'amber' },
  { type: 'SUPPLIER_REFUND', perm: 'purchases.manage', icon: 'arrowIn', hue: 'leaf' },
];

/** All money documents (سندات القبض والصرف). */
export default function Vouchers() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const user = useApp((s) => s.user)!;
  const [f, setF] = useState('all');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listVouchers>>>([]);
  const [chooser, setChooser] = useState(false);
  const page = useRef({ req: 0, done: false, loading: false });
  const creatable = NEW_TYPES.filter((x) => roleHas(user.permissions, x.perm));

  // First page on focus / filter change; more pages as the list nears its end.
  const loadPage = useCallback(
    async (offset: number) => {
      const my = offset === 0 ? ++page.current.req : page.current.req;
      page.current.loading = true;
      try {
        const r = await listVouchers(getDb(), { types: FILTERS.find((x) => x.key === f)?.types, limit: PAGE, offset });
        if (my !== page.current.req) return;
        page.current.done = r.length < PAGE;
        setRows((prev) => (offset === 0 ? r : [...prev, ...r.filter((x) => !prev.some((p) => p.id === x.id))]));
      } finally {
        if (my === page.current.req) page.current.loading = false;
      }
    },
    [f],
  );
  useFocusEffect(
    useCallback(() => {
      page.current.done = false;
      void loadPage(0).catch(() => undefined);
    }, [loadPage]),
  );
  const more = () => {
    if (page.current.done || page.current.loading) return;
    void loadPage(rows.length).catch(() => undefined);
  };
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
          onEndReached={more}
          onEndReachedThreshold={0.5}
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
      {creatable.length ? <Fab onPress={() => (creatable.length === 1 ? router.push({ pathname: '/vouchers/new', params: { type: creatable[0]!.type } }) : setChooser(true))} /> : null}
      <Sheet visible={chooser} onClose={() => setChooser(false)} title={t('voucher.newTitle')}>
        <ListGroup>
          {creatable.map((x, i) => (
            <ListRow
              key={x.type}
              icon={x.icon}
              hue={x.hue}
              title={t(`voucher.title.${x.type}`)}
              last={i === creatable.length - 1}
              onPress={() => {
                setChooser(false);
                router.push({ pathname: '/vouchers/new', params: { type: x.type } });
              }}
            />
          ))}
        </ListGroup>
      </Sheet>
    </Screen>
  );
}
