import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { settle, type PaymentInput, type PaymentMethod } from '@daftarak/shared';
import { Screen, Text, Button, MoneyField, Chip, Card, Banner, Icon, colors, fonts, shadow, haptic } from '../../ui';
import { useCart } from '../../state/cart';
import { useApp } from '../../state/app';
import { approvalsNeeded, postSale, priceDraft } from '../../domain/sales/sales';
import type { SessionUser } from '../../domain/auth/users';
import { useSalesCtx, useSalesSettings } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { ApproveSheet } from '../../features/sales/ApproveSheet';
import { MethodCard } from '../../features/sales/sheets';
import { salesErrorMessage } from '../../features/sales/errors';
import { useOfferCtx } from '../../features/sales/useOffers';
import { money } from '../../lib/format';
import { printReceiptInBackground } from '../../features/printing/autoPrint';

const METHODS: { m: PaymentMethod; icon: 'card' | 'phone' | 'layers' | 'users' | 'book' }[] = [
  { m: 'cash', icon: 'layers' },
  { m: 'card', icon: 'card' },
  { m: 'wallet', icon: 'phone' },
  { m: 'bank', icon: 'book' },
  { m: 'credit', icon: 'users' },
];

/** Round-up suggestions for cash (e.g. 37.50 → 40, 50, 100). */
function cashSuggestions(total: number): number[] {
  const out = new Set<number>([total]);
  for (const step of [500, 1000, 5000, 10_000, 20_000]) out.add(Math.ceil(total / step) * step);
  return [...out].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 4);
}

export default function Pay() {
  const { t, i18n } = useTranslation();
  const ctx = useSalesCtx();
  const settings = useSalesSettings();
  const currency = useCurrency();
  const wallets = useApp((s) => s.settings.wallets ?? []);
  const cart = useCart();
  const draft = cart.draft();
  const oc = useOfferCtx();
  const priced = useMemo(() => priceDraft(draft, settings, oc), [draft, settings, oc]);
  const total = priced.totalMinor;
  const [split, setSplit] = useState(false);
  const [rows, setRows] = useState<PaymentInput[]>([{ method: 'cash', amountMinor: total }]);
  const [active, setActive] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [approval, setApproval] = useState<null | 'discount' | 'price'>(null);
  const fmt = (m: number) => money(m, currency, i18n.language);

  const sum = rows.reduce((s, r) => s + r.amountMinor, 0);
  const remaining = Math.max(0, total - sum);
  const cashIn = rows.filter((r) => r.method === 'cash').reduce((s, r) => s + r.amountMinor, 0);
  const change = Math.max(0, sum - total);
  const row = rows[active] ?? rows[0]!;

  const setRow = (i: number, patch: Partial<PaymentInput>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chooseMethod = (m: PaymentMethod) => {
    setErr(null);
    if (!split) {
      setRows([{ method: m, amountMinor: total, label: m === 'wallet' ? (wallets[0] ?? null) : null }]);
      setActive(0);
    } else setRow(active, { method: m, label: m === 'wallet' ? (wallets[0] ?? null) : null });
  };

  const finish = async (approvedBy?: SessionUser) => {
    if (!ctx) return;
    setErr(null);
    try {
      settle(total, rows, !!draft.customerId);
    } catch (e) {
      return setErr(salesErrorMessage(t, e));
    }
    if (!approvedBy) {
      const need = approvalsNeeded(ctx.user, draft, priced);
      if (need.priceChanges.length) return setApproval('price');
      if (need.violations.length) return setApproval('discount');
    }
    setBusy(true);
    try {
      const r = await postSale(ctx, draft, rows, { approvedBy });
      cart.clear();
      haptic.success();
      // Sale is committed. Printing runs afterwards and can never undo it.
      void printReceiptInBackground(r.docId);
      router.replace({ pathname: '/sales/done', params: { id: r.docId, change: String(r.changeMinor) } });
    } catch (e) {
      setErr(salesErrorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('pay.title')} footer={<Button testID="pay-confirm" title={t('pay.confirm')} loading={busy} disabled={sum < total} onPress={() => void finish()} />}>
      <View style={[{ borderRadius: 24, overflow: 'hidden' }, shadow.lifted]}>
        <LinearGradient colors={colors.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 20, gap: 4 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 }}>{t('pay.due')}</Text>
          <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 38, lineHeight: 50 }}>{fmt(total)}</Text>
          {draft.customerName ? <Text style={{ color: 'rgba(255,255,255,0.85)', fontFamily: fonts.medium, fontSize: 14, lineHeight: 20 }}>{draft.customerName}</Text> : null}
        </LinearGradient>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {METHODS.map((x) => (
          <MethodCard key={x.m} label={t(`pay.methods.${x.m}`)} icon={x.icon} selected={row.method === x.m} onPress={() => chooseMethod(x.m)} />
        ))}
      </View>
      {row.method === 'credit' && !draft.customerId ? <Banner tone="warn" text={t('pay.needCustomer')} /> : null}
      {row.method === 'wallet' && wallets.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {wallets.map((w) => (
            <Chip key={w} label={w} selected={row.label === w} onPress={() => setRow(active, { label: w })} />
          ))}
        </View>
      ) : null}

      <MoneyField testID="pay-amount" label={t('pay.received')} valueMinor={row.amountMinor} onValue={(v) => setRow(active, { amountMinor: v ?? 0 })} />
      {row.method === 'cash' ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {cashSuggestions(split ? remaining + row.amountMinor : total).map((v, i) => (
            <Chip key={v} label={i === 0 ? t('pay.exact') : fmt(v)} selected={row.amountMinor === v} onPress={() => setRow(active, { amountMinor: v })} />
          ))}
        </View>
      ) : null}

      {split ? (
        <Card padded={false}>
          {rows.map((r, i) => (
            <Pressable key={i} onPress={() => setActive(i)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: i === active ? colors.primary[50] : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line }}>
              <Text variant="subtitle" style={{ flex: 1 }}>
                {t(`pay.methods.${r.method}`)}
                {r.label ? ` · ${r.label}` : ''}
              </Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink.DEFAULT }}>{fmt(r.amountMinor)}</Text>
              {rows.length > 1 ? (
                <Pressable hitSlop={8} onPress={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setActive(0); }}>
                  <Icon name="trash" size={18} color={colors.rose[500]} />
                </Pressable>
              ) : null}
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Button
        kind="ghost"
        icon="plus"
        title={t('pay.split')}
        onPress={() => {
          setSplit(true);
          setRows((rs) => {
            const next = [...rs, { method: (rs.some((r) => r.method === 'cash') ? 'card' : 'cash') as PaymentMethod, amountMinor: Math.max(0, total - rs.reduce((s, r) => s + r.amountMinor, 0)) }];
            setActive(next.length - 1);
            return next;
          });
        }}
      />

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="subtitle">{remaining > 0 ? t('pay.remaining') : t('pay.change')}</Text>
          <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 36, color: remaining > 0 ? colors.rose[700] : change > 0 ? colors.leaf[700] : colors.ink.DEFAULT }}>{fmt(remaining > 0 ? remaining : change)}</Text>
        </View>
        {cashIn > 0 && change > 0 ? <Text variant="caption">{t('pay.received')}: {fmt(cashIn)}</Text> : null}
      </Card>
      {err ? <Banner tone="danger" text={err} /> : null}
      <ApproveSheet visible={!!approval} needs={approval ?? 'discount'} onClose={() => setApproval(null)} onApproved={(u) => { setApproval(null); void finish(u); }} />
    </Screen>
  );
}
