import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDb } from '../../db/client';
import { confirmSalePrice, findByBarcode, inventorySummary, listProducts, type ProductListRow } from '../../domain/inventory/products';
import { listCategories } from '../../domain/inventory/catalog';
import { ProductsListView, type CategoryChip, type ProductFilter } from '../../features/inventory/ProductsListView';
import { usePriceReview, refreshPriceReview } from '../../state/priceReview';
import { usePricing } from '../../features/inventory/usePricing';
import { markupPrice } from '../../domain/inventory/quickPricing';
import { money } from '../../lib/format';
import { Sheet, Button, MoneyField, Text } from '../../ui';
import { ProductsMenu, CategoryPickerSheet } from '../../features/inventory/ProductsMenu';
import { useCan, useCurrency } from '../../features/inventory/useInvCtx';
import { useScanner } from '../../state/scanner';
import { bulkSetCategory } from '../../domain/inventory/products';
import { useInvCtx } from '../../features/inventory/useInvCtx';
import { toast } from '../../state/toast';
import { invErrorMessage } from '../../features/inventory/errors';
import { fx } from '../../ui/fx';

type Filter = ProductFilter;
const PAGE = 40;

export default function ProductsTab() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const currency = useCurrency();
  const canManage = useCan('products.manage');
  const showValue = useCan('cost.view');
  const ctx = useInvCtx();
  const [rows, setRows] = useState<ProductListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [cats, setCats] = useState<CategoryChip[]>([]);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof inventorySummary>> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [catPicker, setCatPicker] = useState(false);
  const reviewCount = usePriceReview((s) => s.count);
  const pricing = usePricing();
  const canPrice = useCan('price.change');
  /** «مراجعة سعر»: the product whose sale price is being fixed from the review filter. */
  const [pricing4, setPricing4] = useState<{ row: ProductListRow; price: number | null } | null>(null);
  const [savingPrice, setSavingPrice] = useState(false);
  const done = useRef(false);
  const reqId = useRef(0);
  const loadingMore = useRef(false);

  const query = useCallback(
    (after: { name: string; id: string } | null) =>
      listProducts(getDb(), {
        search,
        lowStockOnly: filter.kind === 'low',
        needsPriceReviewOnly: filter.kind === 'review',
        categoryId: filter.kind === 'category' ? filter.id : null,
        after,
        limit: PAGE,
      }),
    [search, filter],
  );

  const reload = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const [first, s, c] = await Promise.all([query(null), inventorySummary(getDb()), listCategories(getDb())]);
      void refreshPriceReview();
      if (id !== reqId.current) return; // a newer search started
      done.current = first.length < PAGE;
      setRows(first);
      setSummary(s);
      setCats(c.map((x) => ({ ...x, products: Number(x.products) })));
    } catch (e) {
      if (id === reqId.current) toast(invErrorMessage(t, e), 'error');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [query, t]);
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // Debounced search / filter changes (this also does the first load on mount).
  useEffect(() => {
    const h = setTimeout(() => void reload(), search ? 200 : 0);
    return () => clearTimeout(h);
  }, [reload, search]);
  // Coming back to the tab: refresh after the transition. Skips the first focus (the effect above loads).
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!focusedOnce.current) {
        focusedOnce.current = true;
        return;
      }
      const h = setTimeout(() => void reloadRef.current(), 220);
      return () => clearTimeout(h);
    }, []),
  );

  const more = async () => {
    if (loadingMore.current || done.current || loading || !rows.length) return;
    loadingMore.current = true;
    const id = reqId.current;
    try {
      const last = rows[rows.length - 1]!;
      const next = await query({ name: last.name, id: last.id });
      if (id !== reqId.current) return; // list was reloaded meanwhile: these rows belong to the old query
      done.current = next.length < PAGE;
      setRows((r) => [...r, ...next]);
    } catch (e) {
      if (id === reqId.current) toast(invErrorMessage(t, e), 'error');
    } finally {
      loadingMore.current = false;
    }
  };

  const notFound = (code: string) => {
    fx.notFound();
    toast(t('pos.notFound', { code }), 'error');
  };
  const openByCode = async (code: string) => {
    const hit = await findByBarcode(getDb(), code);
    if (hit) router.push({ pathname: '/products/[id]', params: { id: hit.productId } });
    else if (canManage) router.push({ pathname: '/products/form', params: { barcode: code } });
    else notFound(code);
    return null;
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <ProductsListView
        rows={rows}
        loading={loading}
        search={search}
        onSearch={setSearch}
        onSubmitSearch={() => {
          // Hardware scanners type the code and press Enter: exact barcode → open it.
          const q = search.trim();
          if (/^\w{4,}$/.test(q))
            void findByBarcode(getDb(), q).then(
              (h) => {
                if (h) router.push({ pathname: '/products/[id]', params: { id: h.productId } });
                else if (!canManage && /^\d{6,}$/.test(q)) notFound(q);
              },
              (e: unknown) => toast(invErrorMessage(t, e), 'error'),
            );
        }}
        onScan={() => {
          useScanner.getState().set({ continuous: false, onCode: openByCode });
          router.push('/scan');
        }}
        filter={filter}
        onFilter={setFilter}
        categories={cats}
        summary={summary}
        showValue={showValue}
        currency={currency}
        lang={i18n.language}
        selecting={selecting}
        selected={selected}
        onPressRow={(id) => {
          if (selecting) return toggle(id);
          const row = rows.find((r) => r.id === id);
          // In «محتاجة مراجعة سعر»: fix the price right here (cost + markup as the suggestion).
          if (filter.kind === 'review' && row && canManage && canPrice) return setPricing4({ row, price: row.retailPriceMinor || markupPrice(row.costMinor, pricing) });
          router.push({ pathname: '/products/[id]', params: { id } });
        }}
        reviewCount={reviewCount}
        onQuickAdd={canManage ? () => router.push('/products/quick-add') : undefined}
        onLongPressRow={(id) => {
          setSelecting(true);
          setSelected(new Set([id]));
        }}
        onEndReached={() => void more()}
        onAdd={() => router.push({ pathname: '/products/form', params: /^\d{6,}$/.test(search.trim()) ? { barcode: search.trim() } : {} })}
        onImport={() => router.push('/products/import')}
        onMenu={() => setMenu(true)}
        onCancelSelect={() => {
          setSelecting(false);
          setSelected(new Set());
        }}
        onBulkPrice={() => {
          router.push({ pathname: '/products/bulk', params: { ids: [...selected].join(',') } });
          setSelecting(false);
          setSelected(new Set());
        }}
        onBulkCategory={() => setCatPicker(true)}
        canManage={canManage}
        topInset={insets.top}
      />
      <ProductsMenu visible={menu} onClose={() => setMenu(false)} />
      <Sheet
        visible={!!pricing4}
        onClose={() => setPricing4(null)}
        title={pricing4?.row.name}
        footer={
          <>
            <Button
              testID="price-review-save"
              icon="check"
              title={t('priceReview.save')}
              loading={savingPrice}
              disabled={!(pricing4?.price && pricing4.price > 0)}
              onPress={async () => {
                if (!ctx || !pricing4?.price) return;
                setSavingPrice(true);
                try {
                  await confirmSalePrice(ctx, pricing4.row.id, pricing4.price);
                  fx.success();
                  setPricing4(null);
                  void reload();
                } catch (e) {
                  toast(invErrorMessage(t, e), 'error');
                } finally {
                  setSavingPrice(false);
                }
              }}
            />
            <Button kind="ghost" title={t('priceReview.openProduct')} onPress={() => { const id = pricing4?.row.id; setPricing4(null); if (id) router.push({ pathname: '/products/[id]', params: { id } }); }} />
          </>
        }
      >
        {pricing4 ? (
          <>
            {showValue ? <Text variant="caption">{t('priceReview.cost', { cost: money(pricing4.row.costMinor, currency, i18n.language) })}</Text> : null}
            <MoneyField testID="price-review-input" label={`${t('quickAdd.salePrice')} (${pricing4.row.unitName})`} valueMinor={pricing4.price} onValue={(v) => setPricing4({ ...pricing4, price: v })} autoFocus />
          </>
        ) : null}
      </Sheet>
      <CategoryPickerSheet
        visible={catPicker}
        categories={cats}
        onClose={() => setCatPicker(false)}
        onPick={async (categoryId) => {
          setCatPicker(false);
          if (!ctx) return;
          try {
            const n = await bulkSetCategory(ctx, [...selected], categoryId);
            toast(t('bulk.done', { n }));
            setSelecting(false);
            setSelected(new Set());
            void reload();
          } catch (e) {
            toast(invErrorMessage(t, e), 'error');
          }
        }}
      />
    </>
  );
}
