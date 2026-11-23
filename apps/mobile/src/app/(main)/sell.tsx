import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { roleHas } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { fx } from '../../ui/fx';
import { Tip } from '../../features/Tip';
import { useCart } from '../../state/cart';
import { useScanner } from '../../state/scanner';
import { toast } from '../../state/toast';
import { useApp } from '../../state/app';
import { findByBarcode, listProducts } from '../../domain/inventory/products';
import { cartLineFor, listDrafts, parkSale, priceDraft, saveQuotation, type PricedDraft } from '../../domain/sales/sales';
import { getCustomer, partyBalance } from '../../domain/parties/customers';
import { PosView, type SearchHit } from '../../features/sales/PosView';
import { CustomerSheet, InvoiceDiscountSheet, LineSheet, PosMenu } from '../../features/sales/sheets';
import { useSalesCtx, useSalesSettings } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { salesErrorMessage } from '../../features/sales/errors';
import { useOfferCtx } from '../../features/sales/useOffers';
import { Sheet, TextField, Button, Banner } from '../../ui';
import { money } from '../../lib/format';

const NO_HITS: SearchHit[] = [];
const NO_HITS_STATE = { q: '', rows: NO_HITS };

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
  // Hits remember the query they answer, so Enter never adds a stale result.
  const [hitState, setHitState] = useState<{ q: string; rows: SearchHit[] }>(NO_HITS_STATE);
  // The list may lag one keystroke behind while typing (no flicker); Enter only trusts a fresh one.
  const hits = search.trim() ? hitState.rows : NO_HITS;
  const [lineKey, setLineKey] = useState<string | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [discOpen, setDiscOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [parked, setParked] = useState(0);
  const [custNote, setCustNote] = useState<string | null>(null);
  const oc = useOfferCtx();
  const [couponOpen, setCouponOpen] = useState(false);
  const [couponText, setCouponText] = useState('');

  const draft = cart.draft();
  const pricing = useMemo((): { priced: PricedDraft | null; err: unknown } => {
    try {
      return { priced: cart.lines.length ? priceDraft(draft, settings, oc) : null, err: null };
    } catch (e) {
      return { priced: null, err: e };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines, cart.invoiceDiscount, cart.couponCode, settings, oc]);
  const priced = pricing.priced;
  const priceErr = cart.lines.length && pricing.err ? salesErrorMessage(t, pricing.err) : null;
  const parking = useRef(false);

  useFocusEffect(
    useCallback(() => {
      void listDrafts(getDb(), 'INVOICE').then((d) => setParked(d.length));
    }, []),
  );

  // Customer balance / credit-limit note.
  useEffect(() => {
    const id = cart.customerId;
    if (!id) return setCustNote(null);
    let alive = true;
    void (async () => {
      try {
        const db = getDb();
        const [c, bal] = await Promise.all([getCustomer(db, id), partyBalance(db, 'C', id)]);
        if (!alive) return;
        const parts: string[] = [];
        if (bal) parts.push(t('pos.customerBalance', { amount: money(bal, currency, i18n.language) }));
        if (c?.creditLimitMinor && bal > c.creditLimitMinor) parts.push(t('pos.overLimit', { limit: money(c.creditLimitMinor, currency, i18n.language) }));
        setCustNote(parts.join('  ·  ') || null);
      } catch {
        if (alive) setCustNote(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [cart.customerId, currency, i18n.language, t]);

  // Live search (name / partial barcode).
  useEffect(() => {
    const q = search.trim();
    if (!q) return setHitState(NO_HITS_STATE);
    let alive = true;
    const h = setTimeout(
      () =>
        void listProducts(getDb(), { search: q, limit: 15 }).then(
          (r) => alive && setHitState({ q, rows: r }),
          () => alive && setHitState({ q, rows: NO_HITS }),
        ),
      150,
    );
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [search]);

  const addProduct = useCallback(
    async (productId: string, productUnitId: string | null): Promise<string | null> => {
      try {
        const line = await cartLineFor(getDb(), settings, productId, productUnitId, useCart.getState().priceTier);
        useCart.getState().add(line);
        return line.name;
      } catch (e) {
        fx.notFound();
        toast(salesErrorMessage(t, e), 'error');
        return null;
      }
    },
    [settings, t],
  );

  const notFound = useCallback(
    (code: string) => {
      fx.notFound();
      toast(t('pos.notFound', { code }), 'error', roleHas(user?.permissions ?? [], 'products.manage') ? { label: t('pos.addProduct'), onPress: () => router.push({ pathname: '/products/form', params: { barcode: code } }) } : undefined);
      return t('pos.notFound', { code });
    },
    [t, user],
  );

  const addByCode = useCallback(
    async (code: string): Promise<string | null> => {
      try {
        const hit = await findByBarcode(getDb(), code);
        if (!hit) return notFound(code);
        fx.scan();
        return await addProduct(hit.productId, hit.productUnitId);
      } catch (e) {
        fx.notFound();
        toast(salesErrorMessage(t, e), 'error');
        return null;
      }
    },
    [addProduct, notFound, t],
  );

  const line = cart.lines.find((l) => l.key === lineKey) ?? null;
  const park = async () => {
    if (!ctx || !cart.lines.length || parking.current) return;
    parking.current = true;
    try {
      const wasParked = !!cart.sourceId;
      await parkSale(ctx, cart.draft(), cart.sourceId);
      cart.clear();
      if (!wasParked) setParked((n) => n + 1);
      toast(t('pos.parkedDone'));
    } catch (e) {
      toast(salesErrorMessage(t, e), 'error');
    } finally {
      parking.current = false;
    }
  };

  return (
    <>
      <PosView
        topInset={insets.top}
        lines={cart.lines}
        priced={priced}
        tip={
          <>
            {priceErr ? <Banner tone="danger" text={priceErr} /> : null}
            <Tip id="pos" />
          </>
        }
        offerNames={Object.fromEntries(Object.entries(priced?.offers?.lines ?? {}).map(([k, v]) => [k, v.name]))}
        couponLabel={cart.couponCode ? `${t('offers.coupon')}: ${cart.couponCode}` : null}
        onCoupon={oc.offers.some((o) => o.type === 'COUPON') || cart.couponCode ? () => { setCouponText(cart.couponCode ?? ''); setCouponOpen(true); } : undefined}
        lastKey={cart.lastAddedKey}
        customerName={cart.customerName}
        customerNote={custNote}
        search={search}
        hits={hits}
        searched={!!search.trim() && hitState.q === search.trim()}
        currency={currency}
        lang={i18n.language}
        vatLabel={settings.vatRegistered ? t('pos.vat', { rate: settings.vatRateBp / 100 }) : null}
        pricesIncludeVat={settings.pricesIncludeVat}
        parkedCount={parked}
        onSearch={setSearch}
        onSubmitSearch={() => {
          const q = search.trim();
          if (!q) return;
          // Only a result list that answers THIS query may be used as a fallback.
          const single = hitState.q === q && hitState.rows.length === 1 ? hitState.rows[0]! : null;
          setSearch('');
          void (async () => {
            try {
              // A barcode match carries the scanned unit (carton vs piece), so it wins.
              const hit = await findByBarcode(getDb(), q);
              if (hit) {
                fx.scan();
                await addProduct(hit.productId, hit.productUnitId);
              } else if (single) {
                fx.add();
                await addProduct(single.id, null);
              } else notFound(q);
            } catch (e) {
              fx.notFound();
              toast(salesErrorMessage(t, e), 'error');
            }
          })();
        }}
        onScan={() => {
          useScanner.getState().set({ continuous: true, onCode: addByCode });
          router.push('/scan');
        }}
        onPickHit={(id) => {
          fx.add();
          setSearch('');
          void addProduct(id, null);
        }}
        onQty={(key, q) => {
          const cur = cart.lines.find((l) => l.key === key)?.qtyMilli ?? 0;
          if (q > cur) fx.add();
          else fx.remove();
          cart.setQty(key, q);
        }}
        onLine={setLineKey}
        onCustomer={() => setCustOpen(true)}
        onMenu={() => setMenu(true)}
        onPark={park}
        payDisabled={!priced}
        onPay={() => {
          if (!priced) {
            fx.error();
            return toast(priceErr ?? t('errors.unknown'), 'error');
          }
          router.push('/sales/pay');
        }}
        onDiscount={() => setDiscOpen(true)}
      />
      <Sheet
        visible={couponOpen}
        onClose={() => setCouponOpen(false)}
        title={t('offers.coupon')}
        footer={
          <>
            <Button title={t('offers.apply')} disabled={!couponText.trim()} onPress={() => { cart.setCoupon(couponText.trim().toUpperCase()); setCouponOpen(false); }} />
            {cart.couponCode ? <Button kind="ghost" title={t('offers.removeCoupon')} onPress={() => { cart.setCoupon(null); setCouponOpen(false); }} /> : null}
          </>
        }
      >
        <TextField label={t('offers.couponCode')} value={couponText} onChangeText={setCouponText} autoCapitalize="characters" ltr autoFocus />
        {cart.couponCode && priced?.offers?.couponError ? <Banner tone="danger" text={t(`offers.couponErrors.${priced.offers.couponError}`)} /> : null}
      </Sheet>
      <LineSheet
        line={line}
        offerMinor={line ? (priced?.lines.find((l) => l.key === line.key)?.offerDiscountMinor ?? 0) : 0}
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
          fx.remove();
          if (line) cart.remove(line.key);
          setLineKey(null);
        }}
      />
      <CustomerSheet
        visible={custOpen}
        ctx={ctx}
        canAdd={roleHas(user?.permissions ?? [], 'parties.manage')}
        currency={currency}
        lang={i18n.language}
        onClose={() => setCustOpen(false)}
        onPick={async (c) => {
          setCustOpen(false);
          cart.setCustomer(c?.id ?? null, c?.name ?? null, c?.priceTier ?? 'retail');
          // Re-price existing lines for the customer's tier (only lines still at catalog price).
          const tier = c?.priceTier ?? 'retail';
          try {
            for (const l of useCart.getState().lines) {
              if (l.unitPriceMinor !== l.catalogPriceMinor) continue;
              const fresh = await cartLineFor(getDb(), settings, l.productId, l.productUnitId, tier, l.qtyMilli);
              cart.update(l.key, { unitPriceMinor: fresh.unitPriceMinor, catalogPriceMinor: fresh.catalogPriceMinor });
            }
          } catch (e) {
            toast(salesErrorMessage(t, e), 'error');
          }
        }}
      />
      <InvoiceDiscountSheet
        visible={discOpen}
        value={cart.invoiceDiscount}
        base={priced ? Math.max(0, priced.grossMinor - priced.offerDiscountMinor - priced.lineDiscountMinor - priced.couponMinor) : 0}
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
