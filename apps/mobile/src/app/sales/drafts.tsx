import { useCallback, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, EmptyState, Button, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { listDrafts, loadDraft } from '../../domain/sales/sales';
import { useCart } from '../../state/cart';
import { toast } from '../../state/toast';
import { salesErrorMessage } from '../../features/sales/errors';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { useSalesCtx } from '../../features/sales/useSalesCtx';
import { money, dateTimeLabel } from '../../lib/format';

/** Held sales and quotations: tap to load into the POS. */
export default function Drafts() {
  const { t, i18n } = useTranslation();
  const { type } = useLocalSearchParams<{ type: 'INVOICE' | 'QUOTATION' }>();
  const currency = useCurrency();
  const ctx = useSalesCtx();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listDrafts>>>([]);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const opening = useRef(false);
  const load = useCallback(() => {
    let alive = true;
    void listDrafts(getDb(), type ?? 'INVOICE').then(
      (r) => alive && setRows(r),
      (e) => alive && toast(salesErrorMessage(t, e), 'error'),
    );
    return () => {
      alive = false;
    };
  }, [type, t]);
  useFocusEffect(load);

  const open = async (id: string) => {
    if (opening.current) return;
    opening.current = true;
    try {
      const d = await loadDraft(getDb(), id, ctx ? { settings: ctx.settings, user: ctx.user } : {});
      // A held sale comes back at today's prices; manual prices the user may not set go back to the catalog.
      if (d.repriced?.reverted) toast(t('pos.repricedReverted', { n: d.repriced.reverted }), 'error');
      else if (d.repriced?.changed) toast(t('pos.repriced', { n: d.repriced.changed }));
      // A held sale stays held until the resumed cart is posted (postSale removes it) or held again (replaced).
      useCart.getState().load(d, type === 'QUOTATION' ? null : id);
      if (router.canGoBack()) router.back();
      else router.dismissTo('/sales/pos');
    } catch (e) {
      toast(salesErrorMessage(t, e), 'error');
    } finally {
      opening.current = false;
    }
  };

  const confirmOpen = (id: string) => {
    const cart = useCart.getState();
    // Never drop the cart on the counter silently.
    if (!cart.lines.length || cart.sourceId === id) return void open(id);
    Alert.alert(t('pos.replaceCart'), t('pos.replaceCartBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.yes'), style: 'destructive', onPress: () => void open(id) },
    ]);
  };

  return (
    <Screen back title={type === 'QUOTATION' ? t('pos.quotations') : t('pos.parked')}>
      {rows.length === 0 ? <EmptyState icon="clipboard" hue="amber" title={type === 'QUOTATION' ? t('pos.quotationsEmpty') : t('pos.parkedEmpty')} body={type === 'QUOTATION' ? t('pos.quotationsEmptyBody') : t('pos.parkedEmptyBody')} /> : null}
      {rows.map((r) => (
        <Card key={r.id} onPress={r.status === 'CONVERTED' ? undefined : () => confirmOpen(r.id)}>
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
              <Button
                compact
                kind="ghost"
                icon="upload"
                title="PDF"
                loading={pdfBusy === r.id}
                disabled={!!pdfBusy}
                onPress={async () => {
                  setPdfBusy(r.id);
                  try {
                    await (await import('../../features/printing/actions')).sharePdf(r.id);
                  } catch {
                    toast(t('errors.unknown'), 'error');
                  } finally {
                    setPdfBusy(null);
                  }
                }}
              />
            </View>
          ) : null}
        </Card>
      ))}
    </Screen>
  );
}
