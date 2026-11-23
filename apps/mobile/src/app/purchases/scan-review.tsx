/**
 * Review a scanned supplier invoice before it goes into the purchase cart: every line read from the photo is matched to
 * one of the shop's products by name (exact, then "contains"); the user can change the product, add it as a new
 * product, skip it, and edit qty / unit cost. The supplier is matched by name too. Confirm → lines go into the cart and
 * the user reviews and saves the purchase as usual.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas } from '@daftarak/shared';
import { Screen, Text, TextField, Button, Card, Icon, Sheet, QtyField, MoneyField, Banner, Avatar, colors, fonts, shadow } from '../../ui';
import { Pressable } from '../../ui/Press';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { usePurchaseCart } from '../../state/purchaseCart';
import { onNextNewProduct, useOcrScan } from '../../state/ocrScan';
import { toast } from '../../state/toast';
import { getProduct, listProducts } from '../../domain/inventory/products';
import { listParties } from '../../domain/parties/parties';
import { purchaseLineFor } from '../../domain/purchases/purchases';
import { buildReview, matchByName, toMinor, type NamedItem, type ReviewLine } from '../../domain/purchases/ocrMatch';
import { PartyPicker } from '../../features/parties/PartyPicker';
import { partyColor } from '../../features/parties/format';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money } from '../../lib/format';
import { errorMessage } from '../../lib/errors';
import { fx } from '../../ui/fx';

const display = (p: { name: string; variantLabel?: string | null }) => (p.variantLabel ? `${p.name} - ${p.variantLabel}` : p.name);

export default function ScanReview() {
  const { t, i18n } = useTranslation();
  const result = useOcrScan((s) => s.result);
  const ctx = useBizCtx();
  const currency = useCurrency();
  const user = useApp((s) => s.user);
  const fmt = (v: number) => money(v, currency, i18n.language);
  const [lines, setLines] = useState<ReviewLine[] | null>(null);
  const [supplier, setSupplier] = useState<NamedItem | null>(null);
  const [pickSupplier, setPickSupplier] = useState(false);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<NamedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const canAddProduct = !!user && roleHas(user.permissions, 'products.manage');

  useEffect(() => {
    if (!result) return;
    const db = getDb();
    void (async () => {
      try {
        const [products, suppliers] = await Promise.all([listProducts(db, { limit: 10_000 }), listParties(db, 'S', { limit: 5000 })]);
        setLines(buildReview(result.lines, products.map((p) => ({ id: p.id, name: display(p) }))));
        const m = result.supplierName ? matchByName(result.supplierName, suppliers) : null;
        if (m) setSupplier({ id: m.item.id, name: m.item.name });
      } catch (e) {
        toast(errorMessage(t, e), 'error');
        setLines(buildReview(result.lines, []));
      }
    })();
    return () => onNextNewProduct(null);
  }, [result, t]);

  useEffect(() => {
    const q = search.trim();
    if (!q) return setHits([]);
    const h = setTimeout(() => void listProducts(getDb(), { search: q, limit: 20 }).then((r) => setHits(r.map((p) => ({ id: p.id, name: display(p) }))), () => setHits([])), 150);
    return () => clearTimeout(h);
  }, [search]);

  const patch = (key: string, p: Partial<ReviewLine>) => setLines((ls) => (ls ? ls.map((l) => (l.key === key ? { ...l, ...p } : l)) : ls));

  const addNew = (l: ReviewLine) => {
    onNextNewProduct((id) => {
      void getProduct(getDb(), id).then(
        (d) => patch(l.key, { product: { id, name: d ? display(d.product) : l.read }, match: 'new', skip: false }),
        () => patch(l.key, { product: { id, name: l.read }, match: 'new', skip: false }),
      );
    });
    router.push({ pathname: '/products/form', params: { name: l.read, ...(l.costMinor != null ? { cost: String(l.costMinor) } : {}), then: 'ocr' } });
  };

  const ready = (lines ?? []).filter((l) => l.product && !l.skip && l.qtyMilli > 0);
  const confirm = async () => {
    if (inFlight.current || !ctx || !ready.length) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const db = getDb();
      const built = [];
      for (const l of ready) {
        const line = await purchaseLineFor(db, ctx, l.product!.id, null, l.qtyMilli);
        built.push(l.costMinor != null ? { ...line, unitCostMinor: l.costMinor } : line);
      }
      const cart = usePurchaseCart.getState();
      built.forEach((x) => cart.add(x));
      const patchCart: Parameters<typeof cart.set>[0] = {};
      if (supplier) Object.assign(patchCart, { supplierId: supplier.id, supplierName: supplier.name });
      if (result?.invoiceNo && !cart.supplierRef) patchCart.supplierRef = result.invoiceNo;
      if (Object.keys(patchCart).length) cart.set(patchCart);
      useOcrScan.getState().set(null);
      fx.success();
      toast(t('ocr.added', { n: built.length }));
      router.back();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!result) {
    return (
      <Screen back title={t('ocr.reviewTitle')}>
        <Banner tone="warn" text={t('ocr.none')} />
      </Screen>
    );
  }
  const printedTotal = toMinor(result.total);
  const hasUnmatched = (lines ?? []).some((l) => !l.product && !l.skip);

  return (
    <Screen
      back
      title={t('ocr.reviewTitle')}
      footer={<Button testID="ocr-review-confirm" title={t('ocr.confirm', { n: ready.length })} loading={busy} disabled={!ready.length || busy || !lines} onPress={() => void confirm()} />}
    >
      <Text variant="caption">{t('ocr.reviewHint')}</Text>

      <Pressable testID="ocr-review-supplier" onPress={() => setPickSupplier(true)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
        {supplier ? <Avatar name={supplier.name} color={partyColor(supplier.id)} size={38} /> : <Icon name="truck" color={colors.ink.mute} />}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 22, color: supplier ? colors.ink.DEFAULT : colors.ink.mute }}>{supplier?.name ?? t('ocr.supplierNone')}</Text>
          {result.supplierName ? <Text variant="caption">{t('ocr.supplierRead', { name: result.supplierName })}</Text> : null}
        </View>
        <Icon name="chevron" size={16} color={colors.ink.faint} />
      </Pressable>
      {result.invoiceNo || printedTotal != null ? (
        <Card>
          {result.invoiceNo ? <Text variant="body">{t('ocr.invoiceNo', { no: result.invoiceNo })}</Text> : null}
          {printedTotal != null ? <Text variant="body">{t('ocr.invoiceTotal', { total: fmt(printedTotal) })}</Text> : null}
        </Card>
      ) : null}
      {hasUnmatched ? <Banner tone="warn" text={t('ocr.noProductsHint')} /> : null}

      {(lines ?? []).map((l, i) => (
        <Card key={l.key} style={{ opacity: l.skip ? 0.55 : 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: l.product ? colors.ink.DEFAULT : colors.rose[700] }}>{l.product?.name ?? t('ocr.noMatch')}</Text>
              <Text variant="caption">{t('ocr.read', { name: l.read })}</Text>
            </View>
            {l.skip ? (
              <Text style={{ fontSize: 12, color: colors.ink.mute }}>{t('ocr.skipped')}</Text>
            ) : l.match ? (
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: l.match === 'contains' ? colors.amber[100] : colors.leaf[100] }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: l.match === 'contains' ? colors.amber[700] : colors.leaf[700] }}>{t(`ocr.${l.match}`)}</Text>
              </View>
            ) : null}
          </View>
          {!l.skip ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <QtyField label={t('line.qty')} valueMilli={l.qtyMilli} onValue={(v) => patch(l.key, { qtyMilli: v ?? 0 })} />
              </View>
              <View style={{ flex: 1 }}>
                <MoneyField label={t('ocr.unitCost')} valueMinor={l.costMinor} onValue={(v) => patch(l.key, { costMinor: v })} />
              </View>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {!l.skip ? (
              <Pressable testID={`ocr-line-pick-${i}`} onPress={() => { setSearch(normalizeQuery(l.read)); setPickFor(l.key); }} style={chip}>
                <Icon name="search" size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{l.product ? t('ocr.change') : t('ocr.pick')}</Text>
              </Pressable>
            ) : null}
            {!l.skip && canAddProduct && l.match !== 'new' ? (
              <Pressable testID={`ocr-line-new-${i}`} onPress={() => addNew(l)} style={chip}>
                <Icon name="plus" size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{t('ocr.addNew')}</Text>
              </Pressable>
            ) : null}
            <Pressable testID={`ocr-line-skip-${i}`} onPress={() => patch(l.key, { skip: !l.skip })} style={chip}>
              <Icon name={l.skip ? 'refresh' : 'minus'} size={15} color={colors.primary[700]} />
              <Text style={chipText()}>{l.skip ? t('ocr.include') : t('ocr.skip')}</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      <PartyPicker visible={pickSupplier} type="S" currency={currency} lang={i18n.language} onClose={() => setPickSupplier(false)} onPick={(p) => { setSupplier({ id: p.id, name: p.name }); setPickSupplier(false); }} />

      <Sheet visible={pickFor != null} onClose={() => { setPickFor(null); setSearch(''); }} title={t('ocr.pickTitle')}>
        <TextField icon="search" placeholder={t('ocr.searchPh')} value={search} onChangeText={setSearch} latinDigits={false} autoFocus />
        {hits.map((h, i) => (
          <Pressable
            key={h.id}
            onPress={() => { if (pickFor) patch(pickFor, { product: h, match: 'picked', skip: false }); setPickFor(null); setSearch(''); }}
            style={({ pressed }) => ({ padding: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line, backgroundColor: pressed ? colors.paper.sunk : 'transparent' })}
          >
            <Text variant="subtitle">{h.name}</Text>
          </Pressable>
        ))}
      </Sheet>
    </Screen>
  );
}

/** First two words of the read name: a useful starting search that FTS can still match. */
function normalizeQuery(s: string): string {
  return s.split(/\s+/).filter(Boolean).slice(0, 2).join(' ');
}

const chip = ({ pressed }: { pressed: boolean }) => ({
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 5,
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 99,
  backgroundColor: pressed ? colors.primary[100] : colors.primary[50],
});
const chipText = () => ({ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.primary[700] });
