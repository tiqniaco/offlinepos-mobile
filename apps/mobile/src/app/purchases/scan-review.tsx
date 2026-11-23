/**
 * Review a scanned supplier invoice before it goes into the purchase cart: every line read from the photo is matched to
 * one of the shop's products by name (exact; whole-word "contains" must be confirmed; a raw look-alike is only
 * suggested); the user can change the product, add it as a new product, skip it, pick the UNIT the line is in (default:
 * the unit whose cost is closest to the printed price — a carton line goes in as cartons), and edit qty / unit cost.
 * A line nothing matches becomes «صنف جديد» by default (for users who may add products): cleaned name, the invoice's
 * unit, cost = printed price, sale price = cost + the shop's markup (rounded), editable inline; a look-alike of an
 * existing product is offered as «تقصد X؟» instead (duplicate guard). New products are created when the purchase is
 * posted, in the same transaction (nothing is left behind if posting fails), and are marked for a price review.
 * The printed discount and VAT carry into the cart; confirm is blocked while a line needs review or the computed total
 * is more than 1% away from the printed total. The supplier is matched by name too.
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
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
import { listProducts } from '../../domain/inventory/products';
import { listParties } from '../../domain/parties/parties';
import { buildReview, matchByName, repriceNew, reviewProblems, toMinor, type NamedItem, type ReviewLine } from '../../domain/purchases/ocrMatch';
import { markupPrice, normName, QUICK_UNITS, splitNameUnit, type QuickPricing } from '../../domain/inventory/quickPricing';
import { usePricing, useProductSlots } from '../../features/inventory/usePricing';
import { defaultScanUnit, scanPurchaseLines, scanTotals, scanUnitOptions } from '../../domain/purchases/scan';
import { PartyPicker } from '../../features/parties/PartyPicker';
import { partyColor } from '../../features/parties/format';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, qty as fmtQty } from '../../lib/format';
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
  /** Units per product (for the unit picker and the «= N قطعة» hint). */
  const [unitOpts, setUnitOpts] = useState<Record<string, Awaited<ReturnType<typeof scanUnitOptions>>>>({});
  const [check, setCheck] = useState<ReturnType<typeof scanTotals> | null>(null);
  const inFlight = useRef(false);
  const canAddProduct = !!user && roleHas(user.permissions, 'products.manage');
  const pricing = usePricing();
  const pricingRef = useRef(pricing);
  useEffect(() => {
    pricingRef.current = pricing;
  }, [pricing]);
  const slots = useProductSlots();
  const [markupOpen, setMarkupOpen] = useState(false);
  const [markupPct, setMarkupPct] = useState<number | null>(null);

  useEffect(() => {
    if (!result) return;
    const db = getDb();
    void (async () => {
      try {
        const [products, suppliers] = await Promise.all([listProducts(db, { limit: 10_000 }), listParties(db, 'S', { limit: 5000 })]);
        const built = buildReview(result.lines, products.map((p) => ({ id: p.id, name: display(p) })), { autoCreate: canAddProduct, pricing: pricingRef.current });
        for (const l of built) if (l.product) l.unitId = await defaultScanUnit(db, l.product.id, l.costMinor);
        setLines(built);
        const m = result.supplierName ? matchByName(result.supplierName, suppliers) : null;
        if (m) setSupplier({ id: m.item.id, name: m.item.name });
      } catch (e) {
        toast(errorMessage(t, e), 'error');
        setLines(buildReview(result.lines, []));
      }
    })();
    return () => onNextNewProduct(null);
  }, [result, t, canAddProduct]);

  useEffect(() => {
    const q = search.trim();
    if (!q) return setHits([]);
    const h = setTimeout(() => void listProducts(getDb(), { search: q, limit: 20 }).then((r) => setHits(r.map((p) => ({ id: p.id, name: display(p) }))), () => setHits([])), 150);
    return () => clearTimeout(h);
  }, [search]);

  const patch = (key: string, p: Partial<ReviewLine>) => setLines((ls) => (ls ? ls.map((l) => (l.key === key ? { ...l, ...p } : l)) : ls));
  /** Edit a new line's draft product (name / unit / sale price). */
  const patchNew = (key: string, p: Partial<NonNullable<ReviewLine['newItem']>>) =>
    setLines((ls) => (ls ? ls.map((l) => (l.key === key && l.newItem ? { ...l, newItem: { ...l.newItem, ...p } } : l)) : ls));
  /** Cost changed: a new line's sale price follows it until the user types one. */
  const setCost = (l: ReviewLine, v: number | null) =>
    patch(l.key, { costMinor: v, costFromTotal: false, ...(l.newItem && !l.newItem.saleEdited ? { newItem: { ...l.newItem, saleMinor: markupPrice(v, pricing) } } : {}) });
  /** «صنف جديد»: the line becomes a new product (cleaned name, unit from the name, marked-up price). */
  const makeNew = (l: ReviewLine, p: QuickPricing = pricing) => {
    const split = splitNameUnit(l.read);
    patch(l.key, { product: null, match: 'create', skip: false, unitId: null, newItem: l.newItem ?? { name: split.name || l.read, unit: split.unit?.ar ?? null, saleMinor: markupPrice(l.costMinor, p), saleEdited: false } });
  };
  /** New product on a line: re-pick its default unit from the printed price. */
  const setProduct = (key: string, product: NamedItem, match: ReviewLine['match']) => {
    const l = lines?.find((x) => x.key === key);
    patch(key, { product, match, skip: false, unitId: null });
    void defaultScanUnit(getDb(), product.id, l?.costMinor ?? null).then((unitId) => patch(key, { unitId }), () => undefined);
  };

  // Units of every matched product.
  useEffect(() => {
    const ids = [...new Set((lines ?? []).map((l) => l.product?.id).filter((x): x is string => !!x))].filter((id) => !unitOpts[id]);
    if (!ids.length) return;
    let alive = true;
    void Promise.all(ids.map(async (id) => [id, await scanUnitOptions(getDb(), id)] as const)).then(
      (pairs) => alive && setUnitOpts((m) => ({ ...m, ...Object.fromEntries(pairs) })),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [lines, unitOpts]);

  // Live totals check against the printed invoice (VAT mode, discount, 1% tolerance).
  useEffect(() => {
    if (!ctx || !lines || !result) return setCheck(null);
    let alive = true;
    void scanPurchaseLines(getDb(), ctx, lines.filter((l) => !reviewProblems(l).length)).then(
      (built) => alive && setCheck(scanTotals(built, result, ctx.vatRegistered)),
      () => alive && setCheck(null),
    );
    return () => {
      alive = false;
    };
  }, [ctx, lines, result]);

  const ready = (lines ?? []).filter((l) => !l.skip && !reviewProblems(l).length);
  const needsReview = (lines ?? []).filter((l) => reviewProblems(l).length);
  const anySkipped = (lines ?? []).some((l) => l.skip);
  // The printed total is only comparable when every line goes in.
  const blockedByTotal = !!check?.mismatch && !anySkipped;
  const newLines = (lines ?? []).filter((l) => !l.skip && l.match === 'create');
  // Same name + unit twice = one product (as the posting does).
  const newCount = new Set(newLines.map((l) => `${normName(l.newItem?.name ?? '')}|${l.newItem?.unit ?? ''}`)).size;
  const overLimit = slots != null && newCount > slots;
  const confirm = async () => {
    if (inFlight.current || !ctx || !ready.length || needsReview.length || blockedByTotal || overLimit) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const db = getDb();
      const tot = scanTotals(await scanPurchaseLines(db, ctx, ready), result!, ctx.vatRegistered);
      if (tot.mismatch && !anySkipped) return;
      const cart = usePurchaseCart.getState();
      const wasEmpty = !cart.lines.length;
      tot.lines.forEach((x) => cart.add(x));
      const built = tot.lines;
      const patchCart: Parameters<typeof cart.set>[0] = {};
      // The printed discount joins the invoice discount; the VAT mode follows the invoice (when the cart was empty).
      if (tot.invoiceDiscountMinor > 0) patchCart.invoiceDiscountMinor = cart.invoiceDiscountMinor + tot.invoiceDiscountMinor;
      if (wasEmpty) patchCart.pricesIncludeVat = tot.pricesIncludeVat;
      if (supplier) Object.assign(patchCart, { supplierId: supplier.id, supplierName: supplier.name });
      if (result?.invoiceNo && !cart.supplierRef) patchCart.supplierRef = result.invoiceNo;
      if (Object.keys(patchCart).length) cart.set(patchCart);
      useOcrScan.getState().set(null);
      fx.success();
      const fresh = built.filter((x) => x.newProduct).length;
      toast(fresh ? t('ocr.addedWithNew', { n: built.length, k: fresh }) : t('ocr.added', { n: built.length }));
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
  const hasUnmatched = (lines ?? []).some((l) => !l.product && !l.skip && l.match !== 'create');
  const applyMarkup = (pct: number) => {
    const p = { ...pricing, markupBp: Math.round(pct * 100) };
    // «كل الأسعار الجديدة»: every new line, typed prices included.
    setLines((ls) => (ls ? repriceNew(ls.map((l) => (l.newItem ? { ...l, newItem: { ...l.newItem, saleEdited: false } } : l)), p) : ls));
    setMarkupOpen(false);
  };

  return (
    <Screen
      back
      title={t('ocr.reviewTitle')}
      footer={<Button testID="ocr-review-confirm" title={t('ocr.confirm', { n: ready.length })} loading={busy} disabled={!ready.length || busy || !lines || needsReview.length > 0 || blockedByTotal || overLimit} onPress={() => void confirm()} />}
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
      {newCount ? (
        <View style={{ gap: 8 }}>
          <Banner tone="info" text={t('ocr.newHint', { n: newCount, pct: pricing.markupBp / 100 })} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable testID="ocr-bulk-markup" onPress={() => { setMarkupPct(pricing.markupBp / 100); setMarkupOpen(true); }} style={chip}>
              <Icon name="tag" size={15} color={colors.primary[700]} />
              <Text style={chipText()}>{t('ocr.bulkMarkup')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {overLimit ? <Banner tone="danger" text={slots ? t('quickAdd.limitSome', { fits: slots, n: newCount }) : t('quickAdd.limitNone', { n: newCount })} /> : null}
      {needsReview.length ? <Banner tone="warn" text={t('ocr.needsReview', { n: needsReview.length })} /> : null}
      {check?.mismatch ? (
        <Banner tone={blockedByTotal ? 'danger' : 'warn'} text={t('ocr.totalMismatch', { computed: fmt(check.computedTotalMinor), printed: fmt(check.scannedTotalMinor ?? 0) })} />
      ) : null}

      {(lines ?? []).map((l, i) => (
        <Card key={l.key} style={{ opacity: l.skip ? 0.55 : 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ flex: 1 }}>
              {l.match === 'create' && l.newItem && !l.skip ? (
                <TextField testID={`ocr-line-name-${i}`} value={l.newItem.name} onChangeText={(v) => patchNew(l.key, { name: v })} latinDigits={false} placeholder={t('quickAdd.namePh')} />
              ) : (
                <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: l.product ? colors.ink.DEFAULT : colors.rose[700] }}>{l.product?.name ?? t('ocr.noMatch')}</Text>
              )}
              <Text variant="caption">{t('ocr.read', { name: l.read })}</Text>
            </View>
            {l.skip ? (
              <Text style={{ fontSize: 12, color: colors.ink.mute }}>{t('ocr.skipped')}</Text>
            ) : l.match === 'create' ? (
              <View testID={`ocr-line-newtag-${i}`} style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: colors.primary[100] }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: colors.primary[700] }}>{t('ocr.create')}</Text>
              </View>
            ) : l.match ? (
              <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: l.match === 'contains' ? colors.amber[100] : colors.leaf[100] }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: l.match === 'contains' ? colors.amber[700] : colors.leaf[700] }}>{t(`ocr.${l.match}`)}</Text>
              </View>
            ) : null}
          </View>
          {!l.skip && l.product && (unitOpts[l.product.id]?.length ?? 0) > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {unitOpts[l.product.id]!.map((u) => {
                const sel = (l.unitId ?? unitOpts[l.product!.id]!.find((x) => x.isBase)?.id) === u.id;
                return (
                  <Pressable key={u.id} testID={`ocr-line-unit-${i}-${u.factorMilli}`} onPress={() => patch(l.key, { unitId: u.id })} style={({ pressed }) => [chip({ pressed }), sel ? { backgroundColor: colors.primary[500] } : null]}>
                    <Text style={[chipText(), sel ? { color: '#fff' } : null]}>{u.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {!l.skip && l.match === 'create' && l.newItem ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
              {[...new Set([l.newItem.unit ?? 'قطعة', ...QUICK_UNITS])].map((u) => {
                const sel = (l.newItem!.unit ?? 'قطعة') === u;
                return (
                  <Pressable key={u} testID={`ocr-line-newunit-${i}-${u}`} onPress={() => patchNew(l.key, { unit: u })} style={({ pressed }) => [chip({ pressed }), sel ? { backgroundColor: colors.primary[500] } : null]}>
                    <Text style={[chipText(), sel ? { color: '#fff' } : null]}>{u}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
          {!l.skip ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <QtyField label={t('line.qty')} valueMilli={l.qtyMilli || null} onValue={(v) => patch(l.key, { qtyMilli: v ?? 0 })} />
              </View>
              <View style={{ flex: 1 }}>
                <MoneyField label={t('ocr.unitCost')} valueMinor={l.costMinor} onValue={(v) => setCost(l, v)} />
              </View>
              {l.match === 'create' && l.newItem ? (
                <View style={{ flex: 1 }}>
                  <MoneyField testID={`ocr-line-sale-${i}`} label={t('quickAdd.salePrice')} valueMinor={l.newItem.saleMinor} onValue={(v) => patchNew(l.key, { saleMinor: v, saleEdited: true })} />
                </View>
              ) : null}
            </View>
          ) : null}
          {!l.skip && l.match === 'create' && l.newItem?.saleMinor && l.costMinor ? (
            <Text variant="caption">{t('quickAdd.margin', { pct: Math.round(((l.newItem.saleMinor - l.costMinor) * 100) / l.costMinor) })}</Text>
          ) : null}
          {!l.skip && l.product && l.qtyMilli > 0 ? (() => {
            const opts = unitOpts[l.product.id] ?? [];
            const u = opts.find((x) => x.id === l.unitId) ?? opts.find((x) => x.isBase);
            const b = opts.find((x) => x.isBase);
            return u && b && !u.isBase ? <Text variant="caption">{t('ocr.baseEq', { qty: fmtQty(Math.round((l.qtyMilli * u.factorMilli) / 1000)), unit: b.name })}</Text> : null;
          })() : null}
          {!l.skip && reviewProblems(l).length ? <Text style={{ fontSize: 12.5, color: colors.rose[700], fontFamily: fonts.medium }}>{reviewProblems(l).map((p) => t(`ocr.problem.${p}`)).join(' · ')}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {!l.skip && l.match === 'contains' ? (
              <Pressable testID={`ocr-line-confirm-${i}`} onPress={() => patch(l.key, { match: 'confirmed' })} style={chip}>
                <Icon name="check" size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{t('ocr.confirmMatch')}</Text>
              </Pressable>
            ) : null}
            {!l.skip && !l.product && l.suggestion ? (
              <Pressable testID={`ocr-line-suggest-${i}`} onPress={() => setProduct(l.key, l.suggestion!, 'picked')} style={chip}>
                <Icon name="check" size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{t('ocr.didYouMean', { name: l.suggestion.name })}</Text>
              </Pressable>
            ) : null}
            {!l.skip && canAddProduct && l.match !== 'create' && !l.product ? (
              <Pressable testID={`ocr-line-new-${i}`} onPress={() => makeNew(l)} style={chip}>
                <Icon name="plus" size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{l.suggestion ? t('ocr.notThatNew') : t('ocr.addNew')}</Text>
              </Pressable>
            ) : null}
            {!l.skip ? (
              <Pressable testID={`ocr-line-pick-${i}`} onPress={() => { setSearch(normalizeQuery(l.read)); setPickFor(l.key); }} style={chip}>
                <Icon name="search" size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{l.product ? t('ocr.change') : l.match === 'create' ? t('ocr.pickExisting') : t('ocr.pick')}</Text>
              </Pressable>
            ) : null}
            <Pressable testID={`ocr-line-skip-${i}`} onPress={() => patch(l.key, { skip: !l.skip })} style={chip}>
              <Icon name={l.skip ? 'refresh' : 'minus'} size={15} color={colors.primary[700]} />
              <Text style={chipText()}>{l.skip ? t('ocr.include') : t('ocr.skip')}</Text>
            </Pressable>
          </View>
        </Card>
      ))}

      <Sheet visible={markupOpen} onClose={() => setMarkupOpen(false)} title={t('ocr.bulkMarkup')} footer={<Button testID="ocr-bulk-markup-apply" title={t('quickAdd.applyMarkup', { pct: markupPct ?? 0 })} disabled={markupPct == null} onPress={() => markupPct != null && applyMarkup(markupPct)} />}>
        <Text variant="caption">{t('quickAdd.markupHint')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[10, 15, 20, 25, 30, 40, 50].map((p) => (
            <Pressable key={p} onPress={() => setMarkupPct(p)} style={({ pressed }) => [chip({ pressed }), markupPct === p ? { backgroundColor: colors.primary[500] } : null]}>
              <Text style={[chipText(), markupPct === p ? { color: '#fff' } : null]}>{`${p}%`}</Text>
            </Pressable>
          ))}
        </View>
        <QtyField label={t('quickAdd.markupPct')} valueMilli={markupPct == null ? null : Math.round(markupPct * 1000)} onValue={(v) => setMarkupPct(v == null ? null : v / 1000)} />
      </Sheet>

      <PartyPicker visible={pickSupplier} type="S" currency={currency} lang={i18n.language} onClose={() => setPickSupplier(false)} onPick={(p) => { setSupplier({ id: p.id, name: p.name }); setPickSupplier(false); }} />

      <Sheet visible={pickFor != null} onClose={() => { setPickFor(null); setSearch(''); }} title={t('ocr.pickTitle')}>
        <TextField icon="search" placeholder={t('ocr.searchPh')} value={search} onChangeText={setSearch} latinDigits={false} autoFocus />
        {hits.map((h, i) => (
          <Pressable
            key={h.id}
            onPress={() => { if (pickFor) setProduct(pickFor, h, 'picked'); setPickFor(null); setSearch(''); }}
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
