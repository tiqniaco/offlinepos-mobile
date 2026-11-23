import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas, businessDay } from '@daftarak/shared';
import { Screen, Text, Card, Button, Banner, Sheet, TextField, SectionTitle, EmptyState, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { getSale, voidSale } from '../../domain/sales/sales';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { useSalesCtx } from '../../features/sales/useSalesCtx';
import { salesErrorMessage } from '../../features/sales/errors';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { money, qty, dateTimeLabel } from '../../lib/format';
import { printReceipt, sharePdf, whatsappInvoice } from '../../features/printing/actions';

function Row({ label, value, strong, color }: { label: string; value: string; strong?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 3 }}>
      <Text variant={strong ? 'subtitle' : 'body'} style={{ flex: 1 }}>{label}</Text>
      <Text style={{ flexShrink: 0, fontFamily: strong ? fonts.bold : fonts.semibold, fontSize: strong ? 18 : 15, lineHeight: strong ? 26 : 22, color: color ?? colors.ink.DEFAULT }}>{value}</Text>
    </View>
  );
}

export default function SaleDetail() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const currency = useCurrency();
  const ctx = useSalesCtx();
  const user = useApp((s) => s.user);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [s, setS] = useState<Awaited<ReturnType<typeof getSale>>>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | 'print' | 'whatsapp' | 'pdf'>(null);
  const [voiding, setVoiding] = useState(false);
  const voidInFlight = useRef(false);
  const load = useCallback(() => {
    let alive = true;
    void getSale(getDb(), id)
      .then(
        (r) => alive && setS(r),
        () => alive && setS(null),
      )
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [id]);
  useFocusEffect(load);
  const run = async (kind: 'print' | 'whatsapp' | 'pdf') => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === 'print') await printReceipt(id);
      else if (kind === 'whatsapp') await whatsappInvoice(id);
      else await sharePdf(id);
    } finally {
      setBusy(null);
    }
  };
  if (!s) {
    return (
      <Screen back title={t('more.invoices')}>
        {loaded ? <EmptyState icon="card" hue="rose" title={t('invoice.notFound')} /> : <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 32 }} />}
      </Screen>
    );
  }
  const d = s.doc;
  const fmt = (m: number) => money(m, currency, i18n.language);
  const isInvoice = d.type === 'INVOICE';
  const canReturn = isInvoice && d.status === 'POSTED' && roleHas(user?.permissions ?? [], 'sales.return');
  const canVoid = isInvoice && d.status === 'POSTED' && roleHas(user?.permissions ?? [], 'doc.void') && d.businessDay === businessDay(Date.now(), tz) && s.returns.length === 0;
  return (
    <Screen back title={isInvoice ? t('invoice.title', { number: d.number }) : t('invoice.returnTitle', { number: d.number })} subtitle={d.postedAt ? dateTimeLabel(i18n.language, d.postedAt) : undefined}>
      {d.status === 'VOIDED' ? <Banner tone="danger" text={`${t('invoice.voided')}: ${d.voidReason ?? ''}`} /> : null}
      {s.original ? <Banner tone="info" text={t('invoice.of', { number: s.original.number })} /> : null}
      {d.customerName ? (
        <Card>
          <Row label={t('invoice.customer')} value={d.customerName} />
        </Card>
      ) : null}
      <SectionTitle>{t('invoice.lines')}</SectionTitle>
      <Card padded={false}>
        {s.lines.map((l, i) => (
          <View key={l.id} style={{ flexDirection: 'row', gap: 10, padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line }}>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{l.nameSnapshot}</Text>
              <Text variant="caption">
                {qty(l.qtyMilli)} {l.unitNameSnapshot} × {fmt(l.unitPriceMinor)}
                {l.lineDiscountMinor ? `  −${fmt(l.lineDiscountMinor)}` : ''}
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{fmt(l.totalMinor)}</Text>
          </View>
        ))}
      </Card>
      <Card>
        {d.lineDiscountMinor + d.invoiceDiscountMinor > 0 ? <Row label={t('pos.discount')} value={`−${fmt(d.lineDiscountMinor + d.invoiceDiscountMinor)}`} /> : null}
        {d.taxMinor ? <Row label={t('pos.vat', { rate: s.lines[0] ? s.lines[0].taxRateBp / 100 : 0 })} value={fmt(d.taxMinor)} /> : null}
        {d.roundingMinor ? <Row label="±" value={fmt(d.roundingMinor)} /> : null}
        <Row strong label={t('pos.total')} value={fmt(d.totalMinor)} />
        {d.creditMinor ? <Row label={t('invoice.credit')} value={fmt(d.creditMinor)} color={colors.amber[700]} /> : null}
        {s.payments.map((p) => (
          <Row key={p.id} label={`${t(`pay.methods.${p.method}`)}${p.label ? ` · ${p.label}` : ''}`} value={fmt(p.amountMinor)} />
        ))}
        {d.changeMinor ? <Row label={t('pay.change')} value={fmt(d.changeMinor)} /> : null}
      </Card>
      {s.returns.length ? (
        <>
          <SectionTitle>{t('invoice.returns')}</SectionTitle>
          {s.returns.map((r) => (
            <Card key={r.id} onPress={() => router.push({ pathname: '/sales/[id]', params: { id: r.id } })}>
              <Row label={r.number ?? ''} value={`−${fmt(r.totalMinor)}`} color={colors.rose[700]} />
            </Card>
          ))}
        </>
      ) : null}
      {/* Wraps instead of clipping the labels on 360dp phones. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <View style={{ flexGrow: 1, flexBasis: '30%', minWidth: '30%' }}>
          <Button kind="secondary" compact icon="clipboard" title={t('invoice.reprint')} loading={busy === 'print'} disabled={!!busy} onPress={() => void run('print')} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: '30%', minWidth: '30%' }}>
          <Button kind="secondary" compact icon="whatsapp" title={t('share.whatsapp')} loading={busy === 'whatsapp'} disabled={!!busy} onPress={() => void run('whatsapp')} />
        </View>
        <View style={{ flexGrow: 1, flexBasis: '30%', minWidth: '30%' }}>
          <Button kind="secondary" compact icon="file" title="PDF" loading={busy === 'pdf'} disabled={!!busy} onPress={() => void run('pdf')} />
        </View>
      </View>
      {canReturn ? <Button icon="refresh" title={t('invoice.return')} onPress={() => router.push({ pathname: '/sales/return', params: { id } })} /> : null}
      {canVoid ? <Button kind="danger" icon="trash" title={t('invoice.void')} onPress={() => setVoidOpen(true)} /> : null}
      <Sheet
        visible={voidOpen}
        onClose={() => setVoidOpen(false)}
        title={t('invoice.void')}
        footer={
          <Button
            kind="danger"
            title={t('invoice.void')}
            disabled={!reason.trim()}
            loading={voiding}
            onPress={async () => {
              if (!ctx || voidInFlight.current) return;
              voidInFlight.current = true;
              setVoiding(true);
              try {
                await voidSale(ctx, id, reason);
                setVoidOpen(false);
                load();
              } catch (e) {
                toast(salesErrorMessage(t, e), 'error');
              } finally {
                voidInFlight.current = false;
                setVoiding(false);
              }
            }}
          />
        }
      >
        <Text variant="body">{t('invoice.voidConfirm')}</Text>
        <TextField label={t('invoice.voidReason')} value={reason} onChangeText={setReason} latinDigits={false} autoFocus />
      </Sheet>
    </Screen>
  );
}
