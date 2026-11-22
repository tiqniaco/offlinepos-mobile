import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatQty } from '@daftarak/shared';
import { Screen, Text, Card, Button, QtyField, Chip, TextField, Banner, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { getPurchase, postPurchaseReturn, previewPurchaseReturn, returnablePurchaseLines, PurchaseError, type ReturnablePurchaseLine } from '../../domain/purchases/purchases';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money } from '../../lib/format';
import { errorMessage } from '../../lib/errors';

/** Return goods to the supplier: pick quantities → deduct from what we owe (default) or money back. */
export default function PurchaseReturn() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useBizCtx();
  const currency = useCurrency();
  const [lines, setLines] = useState<ReturnablePurchaseLine[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [hasSupplier, setHasSupplier] = useState(false);
  const [how, setHow] = useState<'credit' | 'cash'>('credit');
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void returnablePurchaseLines(getDb(), id).then(setLines);
    void getPurchase(getDb(), id).then((p) => {
      setHasSupplier(!!p?.doc.supplierId);
      if (!p?.doc.supplierId) setHow('cash');
    });
  }, [id]);
  const items = Object.entries(qty).filter(([, q]) => q > 0).map(([lineId, qtyMilli]) => ({ lineId, qtyMilli }));
  useEffect(() => {
    if (!items.length) return setTotal(0);
    void previewPurchaseReturn(getDb(), id, items).then(setTotal, () => setTotal(0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(items), id]);

  const save = async () => {
    if (!ctx) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await postPurchaseReturn(ctx, id, items, [{ method: how, amountMinor: total }], reason);
      router.replace({ pathname: '/purchases/[id]', params: { id: r.docId, fresh: '1' } });
    } catch (e) {
      setErr(e instanceof PurchaseError ? t(`purchase.errors.${e.code}`) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('purchase.return')} footer={<Button title={`${t('purchase.returnConfirm')} · ${money(total, currency, i18n.language)}`} loading={busy} disabled={!total} onPress={() => void save()} />}>
      {lines.map((l) => (
        <Card key={l.lineId}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 21, color: colors.ink.DEFAULT }}>{l.name}</Text>
              <Text variant="caption">{t('purchase.canReturn', { qty: formatQty(l.remainingQtyMilli), unit: l.unitName })}</Text>
            </View>
            <View style={{ width: 110 }}>
              <QtyField valueMilli={qty[l.lineId] ?? null} onValue={(v) => setQty((s) => ({ ...s, [l.lineId]: Math.min(v ?? 0, l.remainingQtyMilli) }))} placeholder="0" editable={l.remainingQtyMilli > 0} />
            </View>
          </View>
        </Card>
      ))}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {hasSupplier ? <Chip label={t('purchase.returnCredit')} selected={how === 'credit'} onPress={() => setHow('credit')} /> : null}
        <Chip label={t('purchase.returnCash')} selected={how === 'cash'} onPress={() => setHow('cash')} />
      </View>
      <TextField label={t('ret.reason')} value={reason} onChangeText={setReason} latinDigits={false} />
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
