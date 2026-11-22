import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, EmptyState, Button, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { deleteDraft, listDrafts, loadDraft } from '../../domain/sales/sales';
import { useCart } from '../../state/cart';
import { useSalesCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, dateTimeLabel } from '../../lib/format';

/** Held sales and quotations: tap to load into the POS. */
export default function Drafts() {
  const { t, i18n } = useTranslation();
  const { type } = useLocalSearchParams<{ type: 'INVOICE' | 'QUOTATION' }>();
  const ctx = useSalesCtx();
  const currency = useCurrency();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listDrafts>>>([]);
  const load = useCallback(() => void listDrafts(getDb(), type ?? 'INVOICE').then(setRows), [type]);
  useFocusEffect(load);
  return (
    <Screen back title={type === 'QUOTATION' ? t('pos.quotations') : t('pos.parked')}>
      {rows.length === 0 ? <EmptyState icon="clipboard" hue="amber" title={type === 'QUOTATION' ? t('pos.quotations') : t('pos.parked')} /> : null}
      {rows.map((r) => (
        <Card
          key={r.id}
          onPress={
            r.status === 'CONVERTED'
              ? undefined
              : async () => {
                  const d = await loadDraft(getDb(), r.id);
                  useCart.getState().load(d, null);
                  if (type === 'INVOICE' && ctx) await deleteDraft(ctx, r.id);
                  router.replace('/(main)/sell');
                }
          }
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{[r.number, r.customerName].filter(Boolean).join(' · ') || t('pos.items', { n: r.lines })}</Text>
              <Text variant="caption">
                {dateTimeLabel(i18n.language, r.createdAt)} · {t('pos.items', { n: r.lines })}
                {r.status === 'CONVERTED' ? ' · ✓' : ''}
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink.DEFAULT }}>{money(r.totalMinor, currency, i18n.language)}</Text>
          </View>
          {type === 'QUOTATION' && r.status !== 'CONVERTED' ? (
            <View style={{ marginTop: 10 }}>
              <Button compact kind="ghost" icon="upload" title="PDF" onPress={() => void import('../../features/printing/actions').then((m) => m.sharePdf(r.id))} />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
