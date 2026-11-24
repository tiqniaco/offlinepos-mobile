import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { PaymentMethod } from '@daftarak/shared';
import { Screen, Text, Button, Card, Chip, TextField, SectionTitle, Banner, QtyField, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { getSale, postReturn, previewReturn, refundablePaid, returnableLines, type ReturnableLine } from '../../domain/sales/sales';
import { useSalesCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { salesErrorMessage } from '../../features/sales/errors';
import { money, qty } from '../../lib/format';
import { toast } from '../../state/toast';
import { useApprovalGate } from '../../features/approval/useApprovalGate';
import type { Approval } from '../../domain/auth/approval';

/** Sales return linked to the original invoice (SPEC §5). */
export default function Return() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useSalesCtx();
  const currency = useCurrency();
  const [lines, setLines] = useState<ReturnableLine[]>([]);
  const [number, setNumber] = useState('');
  const [hasCustomer, setHasCustomer] = useState(false);
  /** Money (non-credit) that can still go back: what was paid on the invoice minus earlier refunds. */
  const [paidLeft, setPaidLeft] = useState<number | null>(null);
  const [sel, setSel] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [reason, setReason] = useState('');
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const inFlight = useRef(false);
  const previewId = useRef(0);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await getSale(getDb(), id);
        const ls = await returnableLines(getDb(), id);
        const paid = await refundablePaid(getDb(), id);
        if (!alive) return;
        setNumber(s?.doc.number ?? '');
        setHasCustomer(!!s?.doc.customerId);
        setPaidLeft(paid.leftMinor);
        // A credit (آجل) invoice is returned to the customer's balance by default, not paid out in cash.
        if (paid.hadCredit && s?.doc.customerId) setMethod('credit');
        setLines(ls);
      } catch (e) {
        if (alive) setErr(salesErrorMessage(t, e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, t]);
  const items = useMemo(() => Object.entries(sel).filter(([, q]) => q > 0).map(([lineId, qtyMilli]) => ({ lineId, qtyMilli })), [sel]);
  useEffect(() => {
    // Only the newest preview may set the total (the refund must equal it exactly).
    const my = ++previewId.current;
    if (!items.length) {
      setPreviewing(false);
      return setTotal(0);
    }
    setPreviewing(true);
    void previewReturn(getDb(), id, items, { cashRoundingMinor: ctx?.settings.cashRoundingMinor })
      .then(
        (v) => my === previewId.current && setTotal(v),
        () => my === previewId.current && setTotal(0),
      )
      .finally(() => my === previewId.current && setPreviewing(false));
  }, [items, id, ctx?.settings.cashRoundingMinor]);
  const fmt = (m: number) => money(m, currency, i18n.language);
  const gate = useApprovalGate();
  const submit = () => {
    if (!ctx || previewing || inFlight.current) return;
    gate.run('return', (a) => post(a), { amountMinor: total });
  };
  const post = async (approval: Approval | null) => {
    if (!ctx || previewing || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErr(null);
    try {
      const r = await postReturn(ctx, id, items, [{ method, amountMinor: total }], reason || '-', { approvedBy: approval });
      toast(method !== 'credit' && r.creditMinor > 0 ? t('ret.doneSplit', { number: r.number, amount: fmt(r.creditMinor) }) : t('ret.done', { number: r.number }));
      router.replace({ pathname: '/sales/[id]', params: { id: r.docId } });
    } catch (e) {
      setErr(salesErrorMessage(t, e));
      inFlight.current = false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen back title={t('ret.title', { number })} footer={<Button testID="return-confirm" title={t('ret.confirm', { amount: fmt(total) })} loading={busy} disabled={!items.length || previewing} onPress={submit} />}>
      {lines.map((l, i) => (
        <Card key={l.lineId}>
          <View style={{ gap: 8, opacity: l.remainingQtyMilli > 0 ? 1 : 0.5 }}>
            <Text variant="subtitle">{l.name}</Text>
            <Text variant="caption">
              {t('ret.sold', { qty: `${qty(l.soldQtyMilli)} ${l.unitName}` })} · {t('ret.left', { qty: qty(l.remainingQtyMilli) })} · {fmt(l.unitPriceMinor)}
            </Text>
            {l.remainingQtyMilli > 0 ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
                <View style={{ flex: 1 }}>
                  <QtyField testID={`return-qty-${i}`} valueMilli={sel[l.lineId] ?? null} onValue={(v) => setSel((s) => ({ ...s, [l.lineId]: Math.min(v ?? 0, l.remainingQtyMilli) }))} />
                </View>
                <Chip label={t('products.all')} selected={sel[l.lineId] === l.remainingQtyMilli} onPress={() => setSel((s) => ({ ...s, [l.lineId]: l.remainingQtyMilli }))} />
              </View>
            ) : null}
          </View>
        </Card>
      ))}
      <SectionTitle>{t('ret.refund')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['cash', 'card', 'wallet', 'bank'] as PaymentMethod[]).map((m) => (
          <Chip key={m} label={t(`pay.methods.${m}`)} selected={method === m} onPress={() => setMethod(m)} />
        ))}
        {hasCustomer ? <Chip label={t('ret.toCredit')} selected={method === 'credit'} onPress={() => setMethod('credit')} /> : null}
      </View>
      <TextField label={t('ret.reason')} placeholder={t('ret.reasonPh')} value={reason} onChangeText={setReason} latinDigits={false} />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text variant="subtitle">{t('pos.total')}</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 30, color: colors.rose[700] }}>{fmt(total)}</Text>
        </View>
      </Card>
      {method !== 'credit' && paidLeft != null && total > paidLeft ? <Banner tone="warn" text={t('ret.overPaid', { paid: fmt(paidLeft), rest: fmt(total - paidLeft) })} /> : null}
      {err ? <Banner tone="danger" text={err} /> : null}
      {gate.sheet}
    </Screen>
  );
}
