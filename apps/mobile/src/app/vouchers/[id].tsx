import { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, roleHas } from '@daftarak/shared';
import { Screen, Text, Card, Button, Sheet, TextField, Banner, IconBadge, EmptyState, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { getVoucher, voidVoucher, VoucherError } from '../../domain/vouchers/vouchers';
import type { Approval } from '../../domain/auth/approval';
import { useApprovalGate } from '../../features/approval/useApprovalGate';
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
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const gate = useApprovalGate();

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
  useFocusEffect(
    useCallback(() => {
      void load()
        .catch(() => setV(null))
        .finally(() => setLoaded(true));
    }, [load]),
  );
  if (!v)
    return (
      <Screen back>
        {loaded ? <EmptyState icon="receipt" hue="sky" title={t('common.notFound')} /> : <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 32 }} />}
      </Screen>
    );

  const openVoid = () => {
    setErr(null);
    setReason('');
    setVoidOpen(true);
  };
  const askVoid = () => {
    if (!ctx || busy) return;
    setErr(null);
    // «تأكيد المدير»: one sheet at a time — the void sheet comes back with the error if the void fails.
    setVoidOpen(false);
    gate.run('void', (a) => doVoid(a), { permission: 'doc.void' });
  };
  const doVoid = async (approval: Approval | null) => {
    if (!ctx || busy) return;
    setErr(null);
    setBusy(true);
    try {
      await voidVoucher(ctx, id, reason, { approvedBy: approval });
      setVoidOpen(false);
      setReason('');
      toast(t('voucher.voided'));
      void load().catch(() => undefined);
    } catch (e) {
      setErr(e instanceof VoucherError ? t(`voucher.errors.${e.code}`) : errorMessage(t, e));
      setVoidOpen(true);
    } finally {
      setBusy(false);
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
      {canVoid ? <Button kind="danger" icon="trash" title={t('voucher.void')} onPress={openVoid} /> : null}
      <Sheet visible={voidOpen} onClose={() => setVoidOpen(false)} title={t('voucher.void')} footer={<Button kind="danger" title={t('voucher.voidConfirm')} loading={busy} disabled={!reason.trim() || busy} onPress={askVoid} />}>
        <TextField label={t('invoice.voidReason')} value={reason} onChangeText={setReason} latinDigits={false} autoFocus />
        {err ? <Banner tone="danger" text={err} /> : null}
      </Sheet>
      {gate.sheet}
    </Screen>
  );
}
