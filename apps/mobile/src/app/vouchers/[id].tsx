import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, roleHas } from '@daftarak/shared';
import { Screen, Text, Card, Button, Sheet, TextField, Banner, IconBadge, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { getVoucher, voidVoucher, VoucherError } from '../../domain/vouchers/vouchers';
import { getParty, owed } from '../../domain/parties/parties';
import { getShift } from '../../domain/shifts/shifts';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader, voucherDoc } from '../../features/export/builders';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, dateTimeLabel } from '../../lib/format';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

type V = NonNullable<Awaited<ReturnType<typeof getVoucher>>>;

export default function VoucherDetail() {
  const { t, i18n } = useTranslation();
  const { id, fresh } = useLocalSearchParams<{ id: string; fresh?: string }>();
  const currency = useCurrency();
  const ctx = useBizCtx();
  const user = useApp((s) => s.user)!;
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [v, setV] = useState<V | null>(null);
  const [mobile, setMobile] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [canVoid, setCanVoid] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = getDb();
    const x = await getVoucher(db, id);
    setV(x);
    if (x?.partyType && x.partyId) {
      const p = await getParty(db, x.partyType, x.partyId);
      setMobile(p?.mobile ?? null);
      setBalance(p ? owed(x.partyType, p.balanceMinor) : null);
    }
    if (x && x.status === 'POSTED' && roleHas(user.permissions, 'doc.void')) {
      if (x.shiftId) setCanVoid((await getShift(db, x.shiftId))?.status === 'OPEN');
      else setCanVoid(x.businessDay === businessDay(Date.now(), tz));
    } else setCanVoid(false);
  }, [id, tz, user.permissions]);
  useFocusEffect(useCallback(() => void load(), [load]));
  if (!v) return <Screen back>{null}</Screen>;

  const doVoid = async () => {
    if (!ctx) return;
    try {
      await voidVoucher(ctx, id, reason);
      setVoidOpen(false);
      toast(t('voucher.voided'));
      void load();
    } catch (e) {
      setErr(e instanceof VoucherError ? t(`voucher.errors.${e.code}`) : errorMessage(t, e));
    }
  };

  const inflow = v.type === 'RECEIPT' || v.type === 'SUPPLIER_REFUND' || v.type === 'CASH_IN';
  return (
    <Screen back title={t(`voucher.title.${v.type}`)} subtitle={v.number} footer={fresh ? <Button title={t('voucher.done')} onPress={() => router.back()} /> : undefined}>
      {fresh ? <Banner tone="success" text={t('voucher.saved')} /> : null}
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge name={inflow ? 'arrowIn' : 'arrowOut'} hue={inflow ? 'leaf' : 'amber'} size={46} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: v.status === 'VOIDED' ? colors.ink.faint : colors.ink.DEFAULT, textDecorationLine: v.status === 'VOIDED' ? 'line-through' : 'none' }}>{money(v.amountMinor, currency, i18n.language)}</Text>
            <Text variant="caption">
              {v.type !== 'OPENING_BALANCE' ? `${t(`pay.methods.${v.method}`)}${v.label ? ` · ${v.label}` : ''} · ` : ''}
              {dateTimeLabel(i18n.language, v.postedAt)}
            </Text>
          </View>
        </View>
        {v.partyName || v.categoryName ? <Text variant="subtitle" style={{ marginTop: 10 }}>{v.partyName ?? v.categoryName}</Text> : null}
        {v.note ? <Text variant="body">{v.note}</Text> : null}
        {balance != null && v.partyType ? <Text variant="caption" style={{ marginTop: 6 }}>{t('report.balanceNow')}: {money(Math.abs(balance), currency, i18n.language)} {balance ? t(balance > 0 === (v.partyType === 'C') ? 'report.owesUs' : 'report.weOwe') : ''}</Text> : null}
        {v.status === 'VOIDED' ? <Text style={{ color: colors.rose[700], fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, marginTop: 6 }}>{t('voucher.voidedBecause', { reason: v.voidReason })}</Text> : null}
      </Card>
      <ExportBar build={async () => voucherDoc(v, await bizHeader(), balance)} mobile={mobile} kinds={['whatsapp', 'print', 'pdf']} />
      {canVoid ? <Button kind="danger" icon="trash" title={t('voucher.void')} onPress={() => setVoidOpen(true)} /> : null}
      <Sheet visible={voidOpen} onClose={() => setVoidOpen(false)} title={t('voucher.void')} footer={<Button kind="danger" title={t('voucher.voidConfirm')} disabled={!reason.trim()} onPress={() => void doVoid()} />}>
        <TextField label={t('invoice.voidReason')} value={reason} onChangeText={setReason} latinDigits={false} autoFocus />
        {err ? <Banner tone="danger" text={err} /> : null}
      </Sheet>
    </Screen>
  );
}
