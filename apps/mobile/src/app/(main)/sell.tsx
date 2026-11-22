import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { roleHas, type PricedCart } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { useCart } from '../../state/cart';
import { useScanner } from '../../state/scanner';
import { toast } from '../../state/toast';
import { useApp } from '../../state/app';
import { findByBarcode, listProducts } from '../../domain/inventory/products';
import { cartLineFor, listDrafts, parkSale, priceDraft, saveQuotation } from '../../domain/sales/sales';
import { getCustomer, partyBalance } from '../../domain/parties/customers';
import { PosView, type SearchHit } from '../../features/sales/PosView';
import { CustomerSheet, InvoiceDiscountSheet, LineSheet, PosMenu } from '../../features/sales/sheets';
import { useSalesCtx, useSalesSettings } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { salesErrorMessage } from '../../features/sales/errors';
import { money } from '../../lib/format';

/** Scan-first POS (SPEC §5): scan → item on top; rescan → qty +1; pay in ≤ 3 taps. */
export default function Sell() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const ctx = useSalesCtx();
  const settings = useSalesSettings();
  const currency = useCurrency();
  const user = useApp((s) => s.user);
  const cart = useCart();
  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [parked, setParked] = useState(0);
  const [custNote, setCustNote] = useState<string | null>(null);

  const draft = cart.draft();
  const priced: PricedCart | null = useMemo(() => {
    try {
      return cart.lines.length ? priceDraft(draft, settings) : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines, cart.invoiceDiscount, settings]);

  useFocusEffect(
    useCallback(() => {
      void listDrafts(getDb(), 'INVOICE').then((d) => setParked(d.length));
    }, []),
  );

  // Customer balance / credit-limit note.
  useEffect(() => {
    if (!cart.customerId) return setCustNote(null);
    void (async () => {
      const db = getDb();
      const [c, bal] = await Promise.all([getCustomer(db, cart.customerId!), partyBalance(db, 'C', cart.customerId!)]);
      const parts: string[] = [];
      if (bal) parts.push(t('pos.customerBalance', { amount: money(bal, currency, i18n.language) }));
      if (c?.creditLimitMinor && bal > c.creditLimitMinor) parts.push(t('pos.overLimit', { limit: money(c.creditLimitMinor, currency, i18n.language) }));
      setCustNote(parts.join('  ·  ') || null);
    })();
  }, [cart.customerId, currency, i18n.language, t]);

  // Live search (name / partial barcode).
  useEffect(() => {
    const q = search.trim();
    if (!q) return setHits([]);
    const h = setTimeout(() => void listProducts(getDb(), { search: q, limit: 15 }).then((r) => setHits(r)), 150);
    return () => clearTimeout(h);
  }, [search]);

  const addProduct = useCallback(
    async (productId: string, productUnitId: string | null) => {
      const line = await cartLineFor(getDb(), settings, productId, productUnitId, useCart.getState().priceTier);
      useCart.getState().add(line);
      return line.name;
    },
    [settings],
  );

  const addByCode = useCallback(
    async (code: string): Promise<string | null> => {
      const hit = await findByBarcode(getDb(), code);
      if (!hit) {
        toast(t('pos.notFound', { code }), 'error', roleHas(user?.permissions ?? [], 'products.manage') ? { label: t('pos.addProduct'), onPress: () => router.push({ pathname: '/products/form', params: { barcode: code } }) } : undefined);
        return t('pos.notFound', { code });
      }
      return addProduct(hit.productId, hit.productUnitId);
    },
    [addProduct, t, user],
  );

  const line = cart.lines.find((l) => l.key === lineKey) ?? null;
  const park = async () => {
    if (!ctx || !cart.lines.length) return;
    try {
      await parkSale(ctx, cart.draft(), cart.sourceId);
      cart.clear();
      setParked((n) => n + 1);
      toast(t('pos.parkedDone'));
    } catch (e) {
      toast(salesErrorMessage(t, e), 'error');
    }
  };

  return (
    <>
      <PosView
        topInset={insets.top}
        lines={cart.lines}
        priced={priced}
        lastKey={cart.lastAddedKey}
        customerName={cart.customerName}
        customerNote={custNote}
        search={search}
        hits={hits}
        currency={currency}
        lang={i18n.language}
        vatLabel={settings.vatRegistered ? t('pos.vat', { rate: settings.vatRateBp / 100 }) : null}
        pricesIncludeVat={settings.pricesIncludeVat}
        parkedCount={parked}
        onSearch={setSearch}
        onSubmitSearch={() => {
          const q = search.trim();
          if (!q) return;
          setSearch('');
          if (hits.length === 1) void addProduct(hits[0]!.id, null);
          else void addByCode(q);
        }}
        onScan={() => {
          useScanner.getState().set({ continuous: true, onCode: addByCode });
          router.push('/scan');
        }}
        onPickHit={(id) => {
          setSearch('');
          void addProduct(id, null);
        }}
        onQty={(key, q) => cart.setQty(key, q)}
        onLine={setLineKey}
        onCustomer={() => setCustOpen(true)}
        onMenu={() => setMenu(true)}
        onPark={park}
        onPay={() => router.push('/sales/pay')}
        onDiscount={() => setDiscOpen(true)}
      />
      <LineSheet
        line={line}
        canChangePrice={roleHas(user?.permissions ?? [], 'price.change')}
        currency={currency}
        lang={i18n.language}
        onClose={() => setLineKey(null)}
        onSave={(patch) => {
          if (line) {
            if ((patch.qtyMilli ?? 1) <= 0) cart.remove(line.key);
            else cart.update(line.key, patch);
          }
          setLineKey(null);
        }}
        onRemove={() => {
          if (line) cart.remove(line.key);
          setLineKey(null);
        }}
      />
      <CustomerSheet
        visible={custOpen}
        ctx={ctx}
        currency={currency}
        lang={i18n.language}
        onClose={() => setCustOpen(false)}
        onPick={async (c) => {
          setCustOpen(false);
          cart.setCustomer(c?.id ?? null, c?.name ?? null, c?.priceTier ?? 'retail');
          // Re-price existing lines for the customer's tier (only lines still at catalog price).
          const tier = c?.priceTier ?? 'retail';
          for (const l of useCart.getState().lines) {
            if (l.unitPriceMinor !== l.catalogPriceMinor) continue;
            const fresh = await cartLineFor(getDb(), settings, l.productId, l.productUnitId, tier, l.qtyMilli);
            cart.update(l.key, { unitPriceMinor: fresh.unitPriceMinor, catalogPriceMinor: fresh.catalogPriceMinor });
          }
        }}
      />
      <InvoiceDiscountSheet
        visible={discOpen}
        value={cart.invoiceDiscount}
        base={priced ? priced.grossMinor - priced.lineDiscountMinor : 0}
        currency={currency}
        lang={i18n.language}
        onClose={() => setDiscOpen(false)}
        onSave={(d) => {
          cart.setInvoiceDiscount(d);
          setDiscOpen(false);
        }}
      />
      <PosMenu
        visible={menu}
        onClose={() => setMenu(false)}
        items={[
          { key: 'parked', icon: 'clipboard', hue: 'amber', title: t('pos.parked'), value: parked ? String(parked) : undefined, onPress: () => router.push({ pathname: '/sales/drafts', params: { type: 'INVOICE' } }) },
          ...(cart.lines.length
            ? [
                {
                  key: 'quote',
                  icon: 'book' as const,
                  hue: 'sky' as const,
                  title: t('pos.quotation'),
                  onPress: async () => {
                    if (!ctx) return;
                    try {
                      const q = await saveQuotation(ctx, cart.draft(), cart.quotationId);
                      cart.clear();
                      toast(t('pos.quotationSaved', { number: q.number }));
                    } catch (e) {
                      toast(salesErrorMessage(t, e), 'error');
                    }
                  },
                },
              ]
            : []),
          { key: 'quotes', icon: 'list', hue: 'sky', title: t('pos.quotations'), onPress: () => router.push({ pathname: '/sales/drafts', params: { type: 'QUOTATION' } }) },
          { key: 'invoices', icon: 'card', hue: 'primary', title: t('pos.invoices'), onPress: () => router.push('/sales') },
          ...(cart.lines.length
            ? [
                {
                  key: 'clear',
                  icon: 'trash' as const,
                  hue: 'rose' as const,
                  danger: true,
                  title: t('pos.clear'),
                  onPress: () => Alert.alert(t('pos.clear'), t('pos.clearConfirm'), [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.yes'), style: 'destructive', onPress: () => cart.clear() }]),
                },
              ]
            : []),
        ]}
      />
    </>
  );
}
