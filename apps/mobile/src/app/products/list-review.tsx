/**
 * Review of a photographed item list before it goes in: every line is matched to an existing product or becomes a
 * new one (cleaned name, unit, qty, cost, sale price — from the list, else cost + the shop's markup). Confirm creates
 * the new products and posts ONE opening-stock document for every quantity, in one transaction.
 * A new product needs a sale price, or «سيب السعر بعدين» (it then shows in «أصناف محتاجة مراجعة سعر»).
 */
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas } from '@daftarak/shared';
import { Screen, Text, TextField, Button, Card, Icon, Sheet, QtyField, MoneyField, Banner, colors, fonts } from '../../ui';
import { Pressable } from '../../ui/Press';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { useListScan } from '../../state/listScan';
import { refreshPriceReview } from '../../state/priceReview';
import { toast } from '../../state/toast';
import { listProducts } from '../../domain/inventory/products';
import { quickAddStock } from '../../domain/inventory/quickAdd';
import { buildListReview, listProblems, listToStockItems, type ListRow } from '../../domain/inventory/listReview';
import { markupPrice, normName, QUICK_UNITS, type QuickPricing } from '../../domain/inventory/quickPricing';
import type { NamedItem } from '../../domain/purchases/ocrMatch';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { usePricing, useProductSlots } from '../../features/inventory/usePricing';
import { invErrorMessage } from '../../features/inventory/errors';
import { fx } from '../../ui/fx';

type Row = ListRow<NamedItem & { unitName?: string }>;
const display = (p: { name: string; variantLabel?: string | null }) => (p.variantLabel ? `${p.name} - ${p.variantLabel}` : p.name);

export default function ListReview() {
  const { t } = useTranslation();
  const result = useListScan((s) => s.result);
  const ctx = useInvCtx();
  const user = useApp((s) => s.user);
  const canCreate = !!user && roleHas(user.permissions, 'products.manage');
  const pricing = usePricing();
  const pricingRef = useRef(pricing);
  useEffect(() => {
    pricingRef.current = pricing;
  }, [pricing]);
  const slots = useProductSlots();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<(NamedItem & { unitName: string })[]>([]);
  const [markupOpen, setMarkupOpen] = useState(false);
  const [markupPct, setMarkupPct] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!result) return;
    void listProducts(getDb(), { limit: 10_000 }).then(
      (ps) => setRows(buildListReview(result.lines, ps.map((p) => ({ id: p.id, name: display(p), unitName: p.unitName })), { autoCreate: canCreate, pricing: pricingRef.current })),
      (e: unknown) => {
        toast(invErrorMessage(t, e), 'error');
        setRows(buildListReview(result.lines, [], { autoCreate: canCreate, pricing: pricingRef.current }));
      },
    );
  }, [result, canCreate, t]);

  useEffect(() => {
    const q = search.trim();
    if (!q) return setHits([]);
    const h = setTimeout(() => void listProducts(getDb(), { search: q, limit: 20 }).then((r) => setHits(r.map((p) => ({ id: p.id, name: display(p), unitName: p.unitName }))), () => setHits([])), 150);
    return () => clearTimeout(h);
  }, [search]);

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => (rs ? rs.map((r) => (r.key === key ? { ...r, ...p } : r)) : rs));
  const setCost = (r: Row, v: number | null) => patch(r.key, { costMinor: v, ...(r.match === 'create' && r.saleFrom !== 'typed' && r.saleFrom !== 'list' ? { saleMinor: markupPrice(v, pricing), saleFrom: 'markup' as const } : {}) });
  const makeNew = (r: Row) => patch(r.key, { product: null, match: 'create', skip: false });
  const applyMarkup = (pct: number) => {
    const p: QuickPricing = { ...pricing, markupBp: Math.round(pct * 100) };
    // «كل الأسعار الجديدة»: every new row priced from its cost (rows without a cost keep theirs).
    setRows((rs) => (rs ? rs.map((r) => (r.match === 'create' && r.costMinor ? { ...r, saleMinor: markupPrice(r.costMinor, p), saleFrom: 'markup' as const, priceLater: false } : r)) : rs));
    setMarkupOpen(false);
  };

  const live = (rows ?? []).filter((r) => !r.skip);
  const problems = live.filter((r) => listProblems(r).length);
  const newRows = live.filter((r) => r.match === 'create');
  const newCount = new Set(newRows.map((r) => `${normName(r.name)}|${r.unit ?? ''}`)).size;
  const missingPrice = newRows.filter((r) => !(r.saleMinor != null && r.saleMinor > 0) && !r.priceLater);
  const overLimit = slots != null && newCount > slots;
  const items = rows ? listToStockItems(rows) : [];

  const confirm = async () => {
    if (inFlight.current || !ctx || !items.length || problems.length || overLimit) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const r = await quickAddStock(ctx, items, { source: 'list_scan', note: t('quickAdd.listNote') });
      useListScan.getState().set(null);
      void refreshPriceReview();
      fx.success();
      toast(t('quickAdd.listDone', { n: r.created, k: items.filter((i) => i.qtyMilli > 0).length }));
      router.dismissTo('/(main)/products');
    } catch (e) {
      toast(invErrorMessage(t, e), 'error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  if (!result) {
    return (
      <Screen back title={t('quickAdd.listReviewTitle')}>
        <Banner tone="warn" text={t('quickAdd.listNone')} />
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t('quickAdd.listReviewTitle')}
      footer={<Button testID="list-review-confirm" title={t('quickAdd.listConfirm', { n: items.length })} loading={busy} disabled={!rows || !items.length || busy || problems.length > 0 || overLimit} onPress={() => void confirm()} />}
    >
      <Text variant="caption">{t('quickAdd.listReviewHint')}</Text>
      {newCount ? <Banner tone="info" text={t('quickAdd.newCount', { n: newCount })} /> : null}
      {overLimit ? <Banner tone="danger" text={slots ? t('quickAdd.limitSome', { fits: slots, n: newCount }) : t('quickAdd.limitNone', { n: newCount })} /> : null}
      {problems.length ? <Banner tone="warn" text={t('ocr.needsReview', { n: problems.length })} /> : null}
      {newRows.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Pressable testID="list-bulk-markup" onPress={() => { setMarkupPct(pricing.markupBp / 100); setMarkupOpen(true); }} style={chip}>
            <Icon name="tag" size={15} color={colors.primary[700]} />
            <Text style={chipText()}>{t('ocr.bulkMarkup')}</Text>
          </Pressable>
          {missingPrice.length ? (
            <Pressable testID="list-price-later-all" onPress={() => setRows((rs) => (rs ? rs.map((r) => (missingPrice.some((m) => m.key === r.key) ? { ...r, priceLater: true } : r)) : rs))} style={chip}>
              <Icon name="clock" size={15} color={colors.primary[700]} />
              <Text style={chipText()}>{t('quickAdd.priceLaterAll', { n: missingPrice.length })}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {(rows ?? []).map((r, i) => {
        const probs = listProblems(r);
        const isNew = r.match === 'create';
        return (
          <Card key={r.key} style={{ opacity: r.skip ? 0.55 : 1, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ flex: 1 }}>
                {isNew && !r.skip ? (
                  <TextField testID={`list-name-${i}`} value={r.name} onChangeText={(v) => patch(r.key, { name: v })} latinDigits={false} placeholder={t('quickAdd.namePh')} />
                ) : (
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: r.product ? colors.ink.DEFAULT : colors.rose[700] }}>{r.product?.name ?? t('ocr.noMatch')}</Text>
                )}
                <Text variant="caption">{t('ocr.read', { name: r.read })}</Text>
              </View>
              {r.skip ? (
                <Text style={{ fontSize: 12, color: colors.ink.mute }}>{t('ocr.skipped')}</Text>
              ) : (
                <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99, backgroundColor: isNew ? colors.primary[100] : r.match === 'contains' ? colors.amber[100] : r.product ? colors.leaf[100] : colors.rose[50] }}>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: isNew ? colors.primary[700] : r.match === 'contains' ? colors.amber[700] : r.product ? colors.leaf[700] : colors.rose[700] }}>
                    {isNew ? t('ocr.create') : r.match === 'contains' ? t('ocr.contains') : r.product ? t('quickAdd.existing') : t('ocr.noMatch')}
                  </Text>
                </View>
              )}
            </View>

            {!r.skip && isNew ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {[...new Set([r.unit ?? 'قطعة', ...QUICK_UNITS])].map((u) => {
                  const sel = (r.unit ?? 'قطعة') === u;
                  return (
                    <Pressable key={u} onPress={() => patch(r.key, { unit: u })} style={({ pressed }) => [chip({ pressed }), sel ? { backgroundColor: colors.primary[500] } : null]}>
                      <Text style={[chipText(), sel ? { color: '#fff' } : null]}>{u}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}

            {!r.skip && (isNew || r.product) ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <QtyField testID={`list-qty-${i}`} label={isNew ? `${t('quickAdd.qtyOnHand')} (${r.unit ?? 'قطعة'})` : `${t('quickAdd.qtyOnHand')} (${r.unit ?? r.product?.unitName ?? ''})`} valueMilli={r.qtyMilli || null} onValue={(v) => patch(r.key, { qtyMilli: v ?? 0 })} />
                </View>
                <View style={{ flex: 1 }}>
                  <MoneyField label={t('quickAdd.cost')} placeholder={t('quickAdd.optional')} valueMinor={r.costMinor} onValue={(v) => setCost(r, v)} />
                </View>
                {isNew ? (
                  <View style={{ flex: 1 }}>
                    <MoneyField testID={`list-sale-${i}`} label={t('quickAdd.salePrice')} valueMinor={r.priceLater ? null : r.saleMinor} onValue={(v) => patch(r.key, { saleMinor: v, saleFrom: 'typed', priceLater: false })} error={probs.includes('price') ? ' ' : undefined} />
                  </View>
                ) : null}
              </View>
            ) : null}
            {!r.skip && isNew && r.priceLater ? <Text variant="caption">{t('quickAdd.priceLaterOn')}</Text> : null}
            {!r.skip && isNew && r.costMinor == null && !r.priceLater ? <Text variant="caption">{t('quickAdd.noCostHint')}</Text> : null}
            {!r.skip && probs.length ? <Text style={{ fontSize: 12.5, color: colors.rose[700], fontFamily: fonts.medium }}>{probs.map((p) => t(`quickAdd.problem.${p}`)).join(' · ')}</Text> : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {!r.skip && r.match === 'contains' ? (
                <Pressable testID={`list-confirm-${i}`} onPress={() => patch(r.key, { match: 'confirmed' })} style={chip}>
                  <Icon name="check" size={15} color={colors.primary[700]} />
                  <Text style={chipText()}>{t('ocr.confirmMatch')}</Text>
                </Pressable>
              ) : null}
              {!r.skip && !r.product && !isNew && r.suggestion ? (
                <Pressable testID={`list-suggest-${i}`} onPress={() => patch(r.key, { product: r.suggestion, match: 'picked' })} style={chip}>
                  <Icon name="check" size={15} color={colors.primary[700]} />
                  <Text style={chipText()}>{t('ocr.didYouMean', { name: r.suggestion.name })}</Text>
                </Pressable>
              ) : null}
              {!r.skip && canCreate && !isNew && !r.product ? (
                <Pressable testID={`list-new-${i}`} onPress={() => makeNew(r)} style={chip}>
                  <Icon name="plus" size={15} color={colors.primary[700]} />
                  <Text style={chipText()}>{r.suggestion ? t('ocr.notThatNew') : t('ocr.addNew')}</Text>
                </Pressable>
              ) : null}
              {!r.skip && isNew && !(r.saleMinor && r.saleMinor > 0) ? (
                <Pressable testID={`list-later-${i}`} onPress={() => patch(r.key, { priceLater: !r.priceLater })} style={({ pressed }) => [chip({ pressed }), r.priceLater ? { backgroundColor: colors.primary[500] } : null]}>
                  <Icon name="clock" size={15} color={r.priceLater ? '#fff' : colors.primary[700]} />
                  <Text style={[chipText(), r.priceLater ? { color: '#fff' } : null]}>{t('quickAdd.priceLater')}</Text>
                </Pressable>
              ) : null}
              {!r.skip ? (
                <Pressable testID={`list-pick-${i}`} onPress={() => { setSearch(r.read.split(/\s+/).slice(0, 2).join(' ')); setPickFor(r.key); }} style={chip}>
                  <Icon name="search" size={15} color={colors.primary[700]} />
                  <Text style={chipText()}>{r.product ? t('ocr.change') : t('ocr.pickExisting')}</Text>
                </Pressable>
              ) : null}
              <Pressable testID={`list-skip-${i}`} onPress={() => patch(r.key, { skip: !r.skip })} style={chip}>
                <Icon name={r.skip ? 'refresh' : 'minus'} size={15} color={colors.primary[700]} />
                <Text style={chipText()}>{r.skip ? t('ocr.include') : t('ocr.skip')}</Text>
              </Pressable>
            </View>
          </Card>
        );
      })}

      <Sheet visible={markupOpen} onClose={() => setMarkupOpen(false)} title={t('ocr.bulkMarkup')} footer={<Button title={t('quickAdd.applyMarkup', { pct: markupPct ?? 0 })} disabled={markupPct == null} onPress={() => markupPct != null && applyMarkup(markupPct)} />}>
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
