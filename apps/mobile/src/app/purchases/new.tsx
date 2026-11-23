import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { formatQty, roleHas, type PaymentInput } from '@daftarak/shared';
import { Screen, Text, TextField, Button, Card, Icon, Chip, Sheet, QtyField, MoneyField, Banner, Avatar, EmptyState, colors, fonts, shadow } from '../../ui';
import { getDb } from '../../db/client';
import { fx } from '../../ui/fx';
import { useApp } from '../../state/app';
import { usePurchaseCart } from '../../state/purchaseCart';
import { useScanner } from '../../state/scanner';
import { toast } from '../../state/toast';
import { findByBarcode, listProducts } from '../../domain/inventory/products';
import { getParty } from '../../domain/parties/parties';
import { postPurchase, pricePurchaseDraft, purchaseLineFor, PurchaseError, type PurchaseLine } from '../../domain/purchases/purchases';
import { PartyPicker } from '../../features/parties/PartyPicker';
import { partyColor } from '../../features/parties/format';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { MethodCard } from '../../features/sales/sheets';
import { money } from '../../lib/format';
import { errorMessage } from '../../lib/errors';

type PayMode = 'credit' | 'cash' | 'partial';

/** New purchase invoice: supplier → scan/search items → cost & qty → save (default: unpaid, on the supplier). */
export default function NewPurchase() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ supplierId?: string }>();
  const ctx = useBizCtx();
  const currency = useCurrency();
  const user = useApp((s) => s.user)!;
  const cart = usePurchaseCart();
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<Awaited<ReturnType<typeof listProducts>>>([]);
  const [pick, setPick] = useState(false);
  const [edit, setEdit] = useState<PurchaseLine | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [mode, setMode] = useState<PayMode>('credit');
  const [paid, setPaid] = useState<number | null>(null);
  const [method, setMethod] = useState<'cash' | 'wallet' | 'bank' | 'card'>('cash');
  const [dueDays, setDueDays] = useState<number | null>(30);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (v: number) => money(v, currency, i18n.language);

  useEffect(() => {
    if (params.supplierId && params.supplierId !== cart.supplierId) void getParty(getDb(), 'S', params.supplierId).then((p) => p && cart.set({ supplierId: p.id, supplierName: p.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.supplierId]);
  useEffect(() => {
    const q = search.trim();
    if (!q) return setHits([]);
    const h = setTimeout(() => void listProducts(getDb(), { search: q, limit: 12 }).then(setHits), 150);
    return () => clearTimeout(h);
  }, [search]);

  const priced = useMemo(() => {
    try {
      return cart.lines.length ? pricePurchaseDraft({ lines: cart.lines, pricesIncludeVat: cart.pricesIncludeVat, invoiceDiscountMinor: cart.invoiceDiscountMinor }, ctx?.vatRegistered ?? false) : null;
    } catch {
      return null;
    }
  }, [cart.lines, cart.pricesIncludeVat, cart.invoiceDiscountMinor, ctx?.vatRegistered]);

  const add = async (productId: string, unitId: string | null) => {
    if (!ctx) return null;
    const l = await purchaseLineFor(getDb(), ctx, productId, unitId);
    usePurchaseCart.getState().add(l);
    return l.name;
  };
  const addByCode = async (code: string) => {
    const hit = await findByBarcode(getDb(), code);
    if (!hit) {
      fx.notFound();
      toast(t('pos.notFound', { code }), 'error', roleHas(user.permissions, 'products.manage') ? { label: t('pos.addProduct'), onPress: () => router.push({ pathname: '/products/form', params: { barcode: code } }) } : undefined);
      return t('pos.notFound', { code });
    }
    fx.scan();
    return add(hit.productId, hit.productUnitId);
  };

  const total = priced?.totalMinor ?? 0;
  const save = async () => {
    if (!ctx || !priced) return;
    setErr(null);
    setBusy(true);
    const paidNow = mode === 'cash' ? total : mode === 'partial' ? Math.min(paid ?? 0, total) : 0;
    const pays: PaymentInput[] = [...(paidNow ? [{ method, amountMinor: paidNow }] : []), ...(total - paidNow ? [{ method: 'credit' as const, amountMinor: total - paidNow }] : [])];
    try {
      const r = await postPurchase(ctx, { supplierId: cart.supplierId, supplierRef: cart.supplierRef, lines: cart.lines, pricesIncludeVat: cart.pricesIncludeVat, invoiceDiscountMinor: cart.invoiceDiscountMinor, dueDays }, pays.length ? pays : [{ method: 'cash', amountMinor: 0 }]);
      cart.clear();
      fx.success();
      setPayOpen(false);
      router.replace({ pathname: '/purchases/[id]', params: { id: r.docId, fresh: '1' } });
    } catch (e) {
      setErr(e instanceof PurchaseError ? t(`purchase.errors.${e.code}`) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('purchase.new')} footer={<Button testID="purchase-next" title={cart.lines.length ? `${t('purchase.save')} · ${fmt(total)}` : t('purchase.save')} disabled={!cart.lines.length} onPress={() => setPayOpen(true)} />}>
      <Pressable testID="purchase-supplier" onPress={() => setPick(true)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
        {cart.supplierId ? <Avatar name={cart.supplierName ?? ''} color={partyColor(cart.supplierId)} size={38} /> : <Icon name="truck" color={colors.ink.mute} />}
        <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 22, color: cart.supplierId ? colors.ink.DEFAULT : colors.ink.mute }}>{cart.supplierName ?? t('parties.pickS')}</Text>
        <Icon name="chevron" size={16} color={colors.ink.faint} />
      </Pressable>
      <TextField label={t('purchase.ref')} value={cart.supplierRef} onChangeText={(v) => cart.set({ supplierRef: v })} ltr placeholder={t('purchase.refPh')} />

      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <TextField icon="search" placeholder={t('pos.search')} value={search} onChangeText={setSearch} latinDigits={false} onSubmitEditing={() => { const q = search.trim(); setSearch(''); if (hits.length === 1) void add(hits[0]!.id, null); else if (q) void addByCode(q); }} />
        </View>
        <Pressable testID="purchase-scan" onPress={() => { useScanner.getState().set({ continuous: true, onCode: addByCode }); router.push('/scan'); }} style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary[600] }}>
          <Icon name="scan" color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
        </Pressable>
      </View>
      {hits.length ? (
        <Card padded={false}>
          {hits.map((h, i) => (
            <Pressable key={h.id} onPress={() => { fx.add(); setSearch(''); void add(h.id, null); }} style={({ pressed }) => ({ padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line, backgroundColor: pressed ? colors.paper.sunk : 'transparent' })}>
              <Text variant="subtitle">{h.name}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {cart.lines.length === 0 ? (
        <EmptyState icon="cart" title={t('purchase.emptyTitle')} body={t('purchase.emptyBody')} />
      ) : (
        cart.lines.map((l, i) => (
          <Pressable key={l.key} onPress={() => setEdit(l)} style={({ pressed }) => [{ padding: 12, borderRadius: 14, backgroundColor: l.key === cart.lastKey ? colors.primary[50] : colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.ink.DEFAULT }}>{l.name}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 21, color: colors.ink.DEFAULT }}>{priced ? fmt(priced.lines[i]!.totalMinor) : ''}</Text>
            </View>
            <Text variant="caption">
              {formatQty(l.qtyMilli)} {l.unitName} × {fmt(l.unitCostMinor)}
              {l.discountMinor ? `  ·  ${t('pos.discount')} ${fmt(l.discountMinor)}` : ''}
            </Text>
          </Pressable>
        ))
      )}
      {priced ? (
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="body">{t('purchase.itemsCount', { n: cart.lines.length })}</Text>
            <Chip label={t(cart.pricesIncludeVat ? 'purchase.inclVat' : 'purchase.exclVat')} selected={cart.pricesIncludeVat} onPress={() => cart.set({ pricesIncludeVat: !cart.pricesIncludeVat })} />
          </View>
          {priced.taxMinor ? <Text variant="caption">{t('report.tax')}: {fmt(priced.taxMinor)}</Text> : null}
          <MoneyField label={t('purchase.invoiceDiscount')} valueMinor={cart.invoiceDiscountMinor || null} onValue={(v) => cart.set({ invoiceDiscountMinor: v ?? 0 })} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text variant="subtitle">{t('report.total')}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 20, lineHeight: 28, color: colors.primary[700] }}>{fmt(total)}</Text>
          </View>
        </Card>
      ) : null}

      <PartyPicker visible={pick} type="S" currency={currency} lang={i18n.language} onClose={() => setPick(false)} onPick={(p) => { cart.set({ supplierId: p.id, supplierName: p.name }); setPick(false); }} />

      <Sheet
        visible={!!edit}
        onClose={() => setEdit(null)}
        title={edit?.name}
        footer={
          <>
            <Button title={t('line.done')} onPress={() => { if (edit) cart.update(edit.key, edit); setEdit(null); }} />
            <Button kind="danger" icon="trash" title={t('line.remove')} onPress={() => { fx.remove(); if (edit) cart.remove(edit.key); setEdit(null); }} />
          </>
        }
      >
        {edit ? (
          <>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <QtyField label={`${t('line.qty')} (${edit.unitName})`} valueMilli={edit.qtyMilli} onValue={(v) => setEdit({ ...edit, qtyMilli: v ?? 0 })} autoFocus />
              </View>
              <View style={{ flex: 1 }}>
                <MoneyField label={t('purchase.cost')} valueMinor={edit.unitCostMinor} onValue={(v) => setEdit({ ...edit, unitCostMinor: v ?? 0 })} />
              </View>
            </View>
            <MoneyField label={t('purchase.lineDiscount')} valueMinor={edit.discountMinor ?? null} onValue={(v) => setEdit({ ...edit, discountMinor: v ?? 0 })} />
          </>
        ) : null}
      </Sheet>

      <Sheet visible={payOpen} onClose={() => setPayOpen(false)} title={`${t('purchase.payTitle')} · ${fmt(total)}`} footer={<Button testID="purchase-confirm" title={t('purchase.confirm')} loading={busy} onPress={() => void save()} />}>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Chip testID="pay-credit" label={t('purchase.modeCredit')} selected={mode === 'credit'} onPress={() => setMode('credit')} />
          <Chip label={t('purchase.modeCash')} selected={mode === 'cash'} onPress={() => setMode('cash')} />
          <Chip label={t('purchase.modePartial')} selected={mode === 'partial'} onPress={() => setMode('partial')} />
        </View>
        {mode === 'credit' && !cart.supplierId ? <Banner tone="warn" text={t('purchase.needSupplier')} /> : null}
        {mode !== 'credit' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['cash', 'wallet', 'bank', 'card'] as const).map((m) => (
              <MethodCard key={m} label={t(`pay.methods.${m}`)} icon={m === 'cash' ? 'layers' : m === 'wallet' ? 'phone' : m === 'bank' ? 'book' : 'card'} selected={method === m} onPress={() => setMethod(m)} />
            ))}
          </View>
        ) : null}
        {mode === 'partial' ? <MoneyField label={t('purchase.paidNow')} valueMinor={paid} onValue={setPaid} autoFocus /> : null}
        {mode !== 'cash' ? (
          <View style={{ gap: 6 }}>
            <Text variant="label">{t('purchase.dueIn')}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[7, 15, 30, 60].map((d) => (
                <Chip key={d} label={t('purchase.days', { n: d })} selected={dueDays === d} onPress={() => setDueDays(d)} />
              ))}
            </View>
          </View>
        ) : null}
        {err ? <Banner tone="danger" text={err} /> : null}
      </Sheet>
    </Screen>
  );
}
