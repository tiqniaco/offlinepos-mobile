import { useEffect, useState } from 'react';
import { fonts } from '../../ui/fonts';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ADJUST_REASONS, postAdjustment, type AdjustReason } from '../../domain/inventory/adjust';
import { Screen, Text, Button, Choice, QtyField, TextField, SectionTitle, Card, Chip, Banner, EmptyState, colors } from '../../ui';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { loadDetail } from '../../features/inventory/loadDetail';
import type { DetailData } from '../../features/inventory/ProductDetailView';
import { invErrorMessage } from '../../features/inventory/errors';
import { qty } from '../../lib/format';
import { toast } from '../../state/toast';

export default function AdjustStock() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useInvCtx();
  const [d, setD] = useState<DetailData | null>(null);
  const [dir, setDir] = useState<1 | -1>(-1);
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState<AdjustReason>('damaged');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    loadDetail(id).then(
      (x) => {
        setD(x);
        setMissing(!x);
      },
      (e: unknown) => {
        toast(invErrorMessage(t, e), 'error');
        setMissing(true);
      },
    );
  }, [id, t]);
  if (!d)
    return missing ? (
      <Screen back title={t('adjust.title')}>
        <EmptyState icon="box" title={t('invErrors.not_found')} />
      </Screen>
    ) : null;
  const after = d.level.qtyMilli + dir * (amount ?? 0);

  const save = async () => {
    if (!ctx || !amount || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await postAdjustment(ctx, { productId: id, deltaMilli: dir * amount, reason, note });
      toast(t('productForm.saved'));
      router.back();
    } catch (e) {
      setErr(invErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('adjust.title')} subtitle={d.name} footer={<Button testID="adjust-save" title={t('adjust.save')} loading={busy} disabled={!amount} onPress={save} />}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Choice compact icon="minus" hue="rose" title={t('adjust.decrease')} selected={dir === -1} onPress={() => { setDir(-1); setReason('damaged'); }} />
        <Choice compact icon="plus" hue="leaf" title={t('adjust.increase')} selected={dir === 1} onPress={() => { setDir(1); setReason('found'); }} />
      </View>
      <QtyField testID="adjust-qty" label={`${t('adjust.qty')} (${d.baseUnitName})`} valueMilli={amount} onValue={setAmount} autoFocus />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="caption">{t('product.stock')}: {qty(d.level.qtyMilli)}</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: after < 0 ? colors.rose[700] : colors.primary[700] }}>{t('adjust.result', { qty: qty(after), unit: d.baseUnitName })}</Text>
        </View>
      </Card>
      {after < 0 ? <Banner tone="warn" text={t('adjust.negativeWarn')} /> : null}
      <SectionTitle>{t('adjust.reason')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ADJUST_REASONS.map((r) => (
          <Chip key={r} label={t(`adjust.reasons.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
        ))}
      </View>
      <TextField label={t('adjust.note')} value={note} onChangeText={setNote} latinDigits={false} />
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
