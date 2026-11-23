import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, formatQty, roleHas } from '@daftarak/shared';
import { Screen, Text, Card, Button, Sheet, TextField, Banner, EmptyState, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { getPurchase, voidPurchase, PurchaseError } from '../../domain/purchases/purchases';
import { getParty } from '../../domain/parties/parties';
import { getShift } from '../../domain/shifts/shifts';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader, purchaseDoc, dayText } from '../../features/export/builders';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, dateTimeLabel } from '../../lib/format';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

type P = NonNullable<Awaited<ReturnType<typeof getPurchase>>>;

export default function PurchaseDetail() {
  const { t, i18n } = useTranslation();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const ctx = useBizCtx();
  const currency = useCurrency();
  const user = useApp((s) => s.user)!;
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [p, setP] = useState<P | null>(null);
  const [mobile, setMobile] = useState<string | null>(null);
  const [canVoid, setCanVoid] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [missing, setMissing] = useState(false);
  const fmt = (v: number) => money(v, currency, i18n.language);

  const load = useCallback(async () => {
    try {
      const db = getDb();
      const x = await getPurchase(db, id);
      setP(x);
      setMissing(!x);
      if (x?.doc.supplierId) setMobile((await getParty(db, 'S', x.doc.supplierId))?.mobile ?? null);
      if (x && x.doc.type === 'PURCHASE' && x.doc.status === 'POSTED' && roleHas(user.permissions, 'doc.void') && !x.returns.some((r) => r.status === 'POSTED')) {
        setCanVoid(x.doc.shiftId ? (await getShift(db, x.doc.shiftId))?.status === 'OPEN' : x.doc.businessDay === businessDay(Date.now(), tz));
      } else setCanVoid(false);
    } catch (e) {
      toast(errorMessage(t, e), 'error');
      setMissing(true); // only shown while nothing has loaded
    }
  }, [id, tz, user.permissions, t]);
  useFocusEffect(useCallback(() => void load(), [load]));
  const doVoid = async () => {
    if (!ctx || voiding) return;
    setErr(null);
    setVoiding(true);
    try {
      await voidPurchase(ctx, id, reason);
      setVoidOpen(false);
      toast(t('voucher.voided'));
      void load();
    } catch (e) {
      setErr(e instanceof PurchaseError ? t(`purchase.errors.${e.code}`) : errorMessage(t, e));
    } finally {
      setVoiding(false);
    }
  };
  if (!p)
    return (
      <Screen back>
        {missing ? <EmptyState icon="cart" title={t('purchase.errors.not_found')} /> : null}
      </Screen>
    );
  const d = p.doc;

  return (
    <Screen back title={t(d.type === 'PURCHASE' ? 'purchase.title' : 'purchase.returnTitle')} subtitle={d.number ?? ''} footer={fresh ? <Button title={t('voucher.done')} onPress={() => router.back()} /> : undefined}>
      {fresh ? <Banner tone="success" text={t('purchase.saved')} /> : null}
      {d.status === 'VOIDED' ? <Banner tone="danger" text={t('voucher.voidedBecause', { reason: d.voidReason })} /> : null}
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Text variant="subtitle">{d.supplierName ?? t('purchase.cashSupplier')}</Text>
            <Text variant="caption">
              {d.postedAt ? dateTimeLabel(i18n.language, d.postedAt) : ''}
              {d.supplierRef ? ` · ${t('purchase.ref')} ${d.supplierRef}` : ''}
            </Text>
          </View>
          <Text style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 30, color: colors.ink.DEFAULT }}>{fmt(d.totalMinor)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <Text variant="label" style={{ color: colors.leaf[700] }}>{t('purchase.paidNow')}: {fmt(d.paidMinor)}</Text>
          {d.creditMinor ? <Text variant="label" style={{ color: colors.amber[700] }}>{t('purchase.onCredit')}: {fmt(d.creditMinor)}</Text> : null}
        </View>
        {d.dueDay ? <Text variant="caption">{t('purchase.dueOn', { day: dayText(d.dueDay) })}</Text> : null}
      </Card>
      <Card padded={false}>
        {p.lines.map((l, i) => (
          <View key={l.id} style={{ flexDirection: 'row', padding: 12, gap: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 21, color: colors.ink.DEFAULT }}>{l.nameSnapshot}</Text>
              <Text variant="caption">{formatQty(l.qtyMilli)} {l.unitNameSnapshot} × {fmt(l.unitCostMinor)}</Text>
            </View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 14.5, lineHeight: 21, color: colors.ink.DEFAULT }}>{fmt(l.totalMinor)}</Text>
          </View>
        ))}
      </Card>
      <ExportBar build={async () => purchaseDoc(p, await bizHeader())} mobile={mobile} kinds={['whatsapp', 'pdf', 'print']} />
      {d.type === 'PURCHASE' && d.status === 'POSTED' && roleHas(user.permissions, 'purchases.manage') ? <Button kind="secondary" icon="refresh" title={t('purchase.return')} onPress={() => router.push({ pathname: '/purchases/return', params: { id } })} /> : null}
      {d.supplierId && d.creditMinor > 0 && roleHas(user.permissions, 'purchases.manage') ? <Button kind="secondary" icon="arrowOut" title={t('parties.pay')} onPress={() => router.push({ pathname: '/vouchers/new', params: { type: 'PAYMENT', partyId: d.supplierId! } })} /> : null}
      {canVoid ? <Button kind="danger" icon="trash" title={t('invoice.void')} onPress={() => { setReason(''); setErr(null); setVoidOpen(true); }} /> : null}
      {p.returns.length ? <Text variant="caption">{t('purchase.hasReturns', { n: p.returns.length })}</Text> : null}
      <Sheet visible={voidOpen} onClose={() => setVoidOpen(false)} title={t('invoice.void')} footer={<Button kind="danger" title={t('voucher.voidConfirm')} disabled={!reason.trim()} loading={voiding} onPress={() => void doVoid()} />}>
        <TextField label={t('invoice.voidReason')} value={reason} onChangeText={setReason} latinDigits={false} autoFocus />
        {err ? <Banner tone="danger" text={err} /> : null}
      </Sheet>
    </Screen>
  );
}
