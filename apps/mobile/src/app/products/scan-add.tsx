/**
 * «امسح الباركود وكمّل»: the camera stays open (a hardware scanner types into the code field instead).
 * - unknown barcode → compact sheet (name, sale price, qty, optional cost; remembers the last unit / category) →
 *   save = product + its opening stock in one go → back to scanning;
 * - known barcode → +1 on a pending list (in the unit the barcode belongs to);
 * - «خلّصت» posts the pending list as ONE opening-stock document.
 * The pending list lives in a store (state/scanAdd), so leaving the screen does not lose it; locking the app or
 * switching user clears it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { normalizeDigits } from '@daftarak/shared';
import { Screen, Text, TextField, Button, Card, Icon, Sheet, QtyField, MoneyField, Banner, Chip, colors, fonts } from '../../ui';
import { Pressable } from '../../ui/Press';
import { getDb } from '../../db/client';
import { findByBarcode, getProduct } from '../../domain/inventory/products';
import { listCategories } from '../../domain/inventory/catalog';
import { quickAddStock } from '../../domain/inventory/quickAdd';
import { markupPrice, QUICK_UNITS } from '../../domain/inventory/quickPricing';
import { useCan, useInvCtx } from '../../features/inventory/useInvCtx';
import { usePricing } from '../../features/inventory/usePricing';
import { invErrorMessage } from '../../features/inventory/errors';
import { refreshPriceReview } from '../../state/priceReview';
import { toast } from '../../state/toast';
import { useScanAdd } from '../../state/scanAdd';
import { qty as fmtQty } from '../../lib/format';
import { fx } from '../../ui/fx';
import { NativeScanner } from '../scan';

const S = useScanAdd;

export default function ScanAdd() {
  const { t } = useTranslation();
  const ctx = useInvCtx();
  const canStock = useCan('stock.adjust');
  const pricing = usePricing();
  const pending = useScanAdd((s) => s.pending);
  const added = useScanAdd((s) => s.added);
  const lastUnit = useScanAdd((s) => s.lastUnit);
  const lastCategoryId = useScanAdd((s) => s.lastCategoryId);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState<{ barcode: string; name: string; sale: number | null; qty: number | null; cost: number | null; saleTyped: boolean } | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busy = useRef(false);

  useEffect(() => {
    void listCategories(getDb()).then(setCats, () => setCats([]));
  }, []);

  const onCode = useCallback(
    async (raw: string) => {
      const c = normalizeDigits(raw).trim();
      const now = Date.now();
      if (!c || busy.current || form || (c === last.current.code && now - last.current.at < 1500)) return;
      last.current = { code: c, at: now };
      busy.current = true;
      try {
        const hit = await findByBarcode(getDb(), c);
        if (!hit) {
          fx.notFound();
          setForm({ barcode: c, name: '', sale: null, qty: 1000, cost: null, saleTyped: false });
          return;
        }
        fx.scan();
        const d = await getProduct(getDb(), hit.productId);
        const name = d ? (d.product.variantLabel ? `${d.product.name} - ${d.product.variantLabel}` : d.product.name) : c;
        if (!canStock) {
          setMsg(t('quickAdd.scanKnown', { name }));
          return;
        }
        const unitName = d?.units.find((u) => u.id === hit.productUnitId)?.unit.nameAr ?? '';
        const key = hit.productUnitId;
        const list = S.getState().pending;
        const ex = list.find((p) => p.key === key);
        const next = ex ? { ...ex, qtyMilli: ex.qtyMilli + 1000 } : { key, productId: hit.productId, productUnitId: hit.productUnitId, name, unitName, qtyMilli: 1000 };
        S.setState({ pending: [next, ...list.filter((p) => p.key !== key)] });
        setMsg(t('quickAdd.scanPlus', { name, qty: fmtQty(next.qtyMilli), unit: unitName }));
      } catch (e) {
        fx.notFound();
        setMsg(invErrorMessage(t, e));
      } finally {
        busy.current = false;
      }
    },
    [form, canStock, t],
  );

  const save = async () => {
    if (!ctx || !form || saving) return;
    if (!form.name.trim() || !(form.sale && form.sale > 0)) return;
    setSaving(true);
    try {
      await quickAddStock(
        ctx,
        [{ create: { name: form.name.trim(), unit: lastUnit, costMinor: form.cost ?? 0, retailPriceMinor: form.sale, needsPriceReview: form.cost == null, barcode: form.barcode, categoryId: lastCategoryId }, qtyMilli: form.qty ?? 0 }],
        { source: 'scan_add', note: t('quickAdd.scanNote') },
      );
      S.setState((s) => ({ added: [form.name.trim(), ...s.added].slice(0, 30) }));
      fx.success();
      setMsg(t('quickAdd.scanSaved', { name: form.name.trim() }));
      setForm(null);
      setCode('');
      if (form.cost == null) void refreshPriceReview();
    } catch (e) {
      toast(invErrorMessage(t, e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (!ctx || posting) return;
    const list = S.getState().pending;
    if (!list.length) return router.back();
    setPosting(true);
    try {
      await quickAddStock(ctx, list.map((p) => ({ productId: p.productId, productUnitId: p.productUnitId, qtyMilli: p.qtyMilli })), { source: 'scan_add', note: t('quickAdd.scanNote') });
      S.setState({ pending: [] });
      fx.success();
      toast(t('quickAdd.scanPosted', { n: list.length }));
      router.back();
    } catch (e) {
      toast(invErrorMessage(t, e), 'error');
    } finally {
      setPosting(false);
    }
  };
  const clearPending = () =>
    Alert.alert(t('quickAdd.scanClear'), t('quickAdd.scanClearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('quickAdd.scanClear'), style: 'destructive', onPress: () => S.setState({ pending: [] }) },
    ]);
  const bump = (key: string, d: number) =>
    S.setState((s) => ({ pending: s.pending.map((p) => (p.key === key ? { ...p, qtyMilli: Math.max(0, p.qtyMilli + d) } : p)).filter((p) => p.qtyMilli > 0) }));

  const salePlaceholder = form?.cost ? markupPrice(form.cost, pricing) : null;

  return (
    <Screen
      back
      title={t('quickAdd.scanTitle')}
      footer={<Button testID="scan-add-finish" icon="check" title={pending.length ? t('quickAdd.scanFinish', { n: pending.length }) : t('common.done')} loading={posting} onPress={() => void finish()} />}
    >
      <View style={{ height: 230, borderRadius: 20, overflow: 'hidden', backgroundColor: '#000' }}>
        {Platform.OS === 'web' ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff' }}>{t('scan.unavailable')}</Text>
          </View>
        ) : (
          <NativeScanner active={!form} onCode={(c) => void onCode(c)} onError={setMsg} />
        )}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 220, height: 120, borderRadius: 18, borderWidth: 3, borderColor: colors.accent.onDark }} />
        </View>
      </View>
      {msg ? <Banner tone="info" text={msg} /> : null}

      {/* Hardware (keyboard-wedge) scanners type the code + Enter here; the field stays focused. */}
      <TextField
        testID="scan-add-code"
        icon="scan"
        placeholder={t('quickAdd.scanCodePh')}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={() => {
          const c = code;
          setCode('');
          void onCode(c);
        }}
        returnKeyType="done"
        submitBehavior="submit"
        ltr
      />
      {!canStock ? <Banner tone="warn" text={t('quickAdd.scanHintNoStock')} /> : null}

      {pending.length ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="subtitle">{t('quickAdd.scanPending', { n: pending.length })}</Text>
            <Pressable onPress={clearPending} hitSlop={8}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13, color: colors.rose[700] }}>{t('quickAdd.scanClear')}</Text>
            </Pressable>
          </View>
          <Card padded={false}>
            {pending.map((p, i) => (
              <View key={p.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 14.5, lineHeight: 21, color: colors.ink.DEFAULT }}>{p.name}</Text>
                  <Text variant="caption">{`${fmtQty(p.qtyMilli)} ${p.unitName}`}</Text>
                </View>
                <Pressable accessibilityLabel="-" onPress={() => bump(p.key, -1000)} style={{ padding: 8 }}>
                  <Icon name="minus" size={18} color={colors.primary[700]} />
                </Pressable>
                <Pressable accessibilityLabel="+" onPress={() => bump(p.key, 1000)} style={{ padding: 8 }}>
                  <Icon name="plus" size={18} color={colors.primary[700]} />
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : (
        <Text variant="caption">{t('quickAdd.scanEmpty')}</Text>
      )}
      {added.length ? <Text variant="caption">{t('quickAdd.scanAdded', { n: added.length, names: added.slice(0, 5).join('، ') })}</Text> : null}

      <Sheet
        visible={!!form}
        onClose={() => setForm(null)}
        title={t('quickAdd.scanNewTitle')}
        footer={<Button testID="scan-add-save" icon="check" title={t('quickAdd.scanSave')} loading={saving} disabled={!form?.name.trim() || !(form?.sale && form.sale > 0)} onPress={() => void save()} />}
      >
        {form ? (
          <>
            <Text variant="caption">{t('quickAdd.scanCode', { code: form.barcode })}</Text>
            <TextField testID="scan-add-name" label={t('quickAdd.name')} placeholder={t('quickAdd.namePh')} value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} latinDigits={false} autoFocus returnKeyType="next" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <MoneyField testID="scan-add-sale" label={t('quickAdd.salePrice')} placeholder={salePlaceholder ? String(salePlaceholder / 100) : undefined} valueMinor={form.sale} onValue={(v) => setForm({ ...form, sale: v, saleTyped: true })} returnKeyType="next" onSubmitEditing={() => void save()} />
              </View>
              <View style={{ flex: 1 }}>
                <QtyField testID="scan-add-qty" label={`${t('quickAdd.qtyOnHand')} (${lastUnit})`} valueMilli={form.qty} onValue={(v) => setForm({ ...form, qty: v })} onSubmitEditing={() => void save()} />
              </View>
            </View>
            <MoneyField
              label={t('quickAdd.costOptional')}
              valueMinor={form.cost}
              onValue={(v) => setForm({ ...form, cost: v, sale: form.saleTyped ? form.sale : markupPrice(v, pricing) })}
              onSubmitEditing={() => void save()}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {QUICK_UNITS.map((u) => (
                <Chip key={u} label={u} selected={lastUnit === u} onPress={() => S.setState({ lastUnit: u })} />
              ))}
            </ScrollView>
            {cats.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip label={t('products.noCategory')} selected={lastCategoryId == null} onPress={() => S.setState({ lastCategoryId: null })} />
                {cats.map((c) => (
                  <Chip key={c.id} label={c.name} dot={c.color} selected={lastCategoryId === c.id} onPress={() => S.setState({ lastCategoryId: c.id })} />
                ))}
              </ScrollView>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}
