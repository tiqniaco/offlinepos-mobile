/**
 * DEV-ONLY design gallery for the web preview (`npx expo start --web`): renders the pure views with
 * sample data so designers can review screens without a phone. Not reachable on devices or in
 * release builds (route guard in _layout.tsx + Platform check here).
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { LockView, type LockUser } from '../features/lock/LockView';
import { HomeView } from '../features/home/HomeView';
import { MoreView } from '../features/more/MoreView';
import { Banner, applyTheme, applyFont, useTheme, type PaletteId, type Appearance } from '../ui';
import { AppearanceView } from '../features/settings/AppearanceView';
import { PosView } from '../features/sales/PosView';
import { ReceiptView } from '../features/printing/ReceiptView';
import { DEFAULT_RECEIPT } from '../domain/settings/settings';
import { priceCart, zatcaTlvBase64, zatcaTimestamp } from '@daftarak/shared';
import { View } from 'react-native';

const SAMPLE_CART = [
  { key: 'a', productId: 'a', productUnitId: 'a', name: 'شاي العروسة 250 جم', unitName: 'قطعة', qtyMilli: 3000, factorMilli: 1000, unitPriceMinor: 2200, catalogPriceMinor: 2200, taxRateBp: 1400 },
  { key: 'b', productId: 'b', productUnitId: 'b', name: 'زيت عافية 800 مل', unitName: 'زجاجة', qtyMilli: 1000, factorMilli: 1000, unitPriceMinor: 7450, catalogPriceMinor: 7450, taxRateBp: 1400, discount: { type: 'percent' as const, bp: 500 } },
  { key: 'c', productId: 'c', productUnitId: 'c', name: 'أرز الضحى 1 كيلو', unitName: 'كرتونة', qtyMilli: 1000, factorMilli: 12000, unitPriceMinor: 39000, catalogPriceMinor: 39000, taxRateBp: 1400 },
];
const SAMPLE_RECEIPT = {
  kind: 'INVOICE' as const,
  title: 'فاتورة ضريبية مبسطة',
  number: 'INV-A-000123',
  date: Date.UTC(2026, 10, 22, 14, 35),
  businessName: 'سوبر ماركت النور',
  address: 'الرياض — حي النخيل، شارع التخصصي',
  phones: ['966501234567'],
  vatNumber: '310122393500003',
  logoPath: null,
  cashier: 'أحمد',
  customerName: 'محمود علي',
  customerBalanceMinor: 12_500,
  lines: [
    { name: 'شاي العروسة 250 جم', qtyMilli: 3000, unit: 'قطعة', priceMinor: 2200, discountMinor: 0, totalMinor: 6600 },
    { name: 'زيت عافية 800 مل', qtyMilli: 1000, unit: 'زجاجة', priceMinor: 7450, discountMinor: 373, totalMinor: 7077 },
    { name: 'أرز الضحى 1 كيلو', qtyMilli: 1000, unit: 'كرتونة', priceMinor: 39000, discountMinor: 0, totalMinor: 39000 },
  ],
  discountMinor: 373,
  netMinor: 45_802,
  taxMinor: 6875,
  taxRatePct: 15,
  roundingMinor: 0,
  totalMinor: 52_677,
  creditMinor: 0,
  changeMinor: 7323,
  tenderedMinor: 60_000,
  payments: [{ method: 'cash', label: null, amountMinor: 52_677 }],
  voided: false,
  qr: zatcaTlvBase64({ sellerName: 'سوبر ماركت النور', vatNumber: '310122393500003', timestamp: zatcaTimestamp(Date.UTC(2026, 10, 22, 14, 35)), totalWithVatMinor: 52_677, vatMinor: 6875 }),
  currency: 'SAR' as const,
  template: DEFAULT_RECEIPT,
};
import { dateLabel } from '../lib/format';
import { ProductsListView } from '../features/inventory/ProductsListView';
import { ProductDetailView } from '../features/inventory/ProductDetailView';

const SAMPLE_PRODUCTS = [
  { id: 'a', name: 'شاي العروسة 250 جم', variantLabel: null, retailPriceMinor: 2200, trackStock: true, lowStockMilli: 12000, imagePath: null, qtyMilli: 48000, unitName: 'قطعة', categoryColor: '#18A999' },
  { id: 'b', name: 'زيت عافية 800 مل', variantLabel: null, retailPriceMinor: 7450, trackStock: true, lowStockMilli: 10000, imagePath: null, qtyMilli: 6000, unitName: 'زجاجة', categoryColor: '#F2A93B' },
  { id: 'c', name: 'أرز الضحى 1 كيلو', variantLabel: null, retailPriceMinor: 3500, trackStock: true, lowStockMilli: 20000, imagePath: null, qtyMilli: 0, unitName: 'كيلو', categoryColor: '#F2A93B' },
  { id: 'd', name: 'تيشيرت قطن', variantLabel: 'XL', retailPriceMinor: 25000, trackStock: true, lowStockMilli: null, imagePath: null, qtyMilli: 14000, unitName: 'قطعة', categoryColor: '#3B82C4' },
  { id: 'e', name: 'جبنة دومتي 500 جم', variantLabel: null, retailPriceMinor: 6000, trackStock: true, lowStockMilli: 5000, imagePath: null, qtyMilli: 23000, unitName: 'علبة', categoryColor: '#D9534A' },
  { id: 'f', name: 'كيس بلاستيك', variantLabel: null, retailPriceMinor: 50, trackStock: false, lowStockMilli: null, imagePath: null, qtyMilli: 0, unitName: 'قطعة', categoryColor: null },
];

const USERS: LockUser[] = [
  { id: '1', name: 'أحمد', color: '#18A999', roleName: 'المالك', biometricEnabled: true },
  { id: '2', name: 'منى', color: '#F2A93B', roleName: 'مدير', biometricEnabled: false },
  { id: '3', name: 'كريم', color: '#3B82C4', roleName: 'كاشير', biometricEnabled: false },
];

export default function DevGallery() {
  const { view = 'home', palette, mode } = useLocalSearchParams<{ view?: string; palette?: string; mode?: string }>();
  const theme = useTheme();
  useEffect(() => {
    if (palette || mode) applyTheme((palette as PaletteId) ?? theme.palette, (mode as Appearance) ?? theme.appearance, false);
  }, [palette, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pin, setPin] = useState(view === 'lock-pin' ? '12' : '');
  if (Platform.OS !== 'web' || !__DEV__) return null;
  const noop = () => undefined;
  if (view === 'lock' || view === 'lock-pin')
    return (
      <LockView
        businessName="سوبر ماركت النور"
        users={USERS}
        selected={view === 'lock-pin' ? USERS[0]! : null}
        pin={pin}
        message={null}
        busy={false}
        bioAvailable
        onSelect={noop}
        onPin={setPin}
        onSubmit={noop}
        onBiometric={noop}
      />
    );
  if (view === 'appearance') return <AppearanceView palette={theme.palette} appearance={theme.appearance} font={theme.font} onFont={(f) => void applyFont(f)} lang="ar" onPalette={(p) => applyTheme(p, theme.appearance, false)} onAppearance={(a) => applyTheme(theme.palette, a, false)} />;
  if (view === 'pos' || view === 'pos-empty')
    return (
      <PosView
        topInset={0}
        lines={view === 'pos' ? SAMPLE_CART : []}
        priced={view === 'pos' ? priceCart({ lines: SAMPLE_CART, pricesIncludeVat: true }) : null}
        lastKey="c"
        customerName={view === 'pos' ? 'محمود علي' : null}
        customerNote={view === 'pos' ? 'عليه 125.00 ج.م' : null}
        search=""
        hits={[]}
        currency="EGP"
        lang="ar"
        vatLabel="الضريبة 14%"
        pricesIncludeVat
        parkedCount={2}
        onSearch={noop}
        onSubmitSearch={noop}
        onScan={noop}
        onPickHit={noop}
        onQty={noop}
        onLine={noop}
        onCustomer={noop}
        onMenu={noop}
        onPark={noop}
        onPay={noop}
        onDiscount={noop}
      />
    );
  if (view === 'receipt58' || view === 'receipt80')
    return (
      <View style={{ backgroundColor: '#ddd', alignItems: 'flex-start', padding: 0 }}>
        <View testID="receipt" collapsable={false}>
          <ReceiptView d={SAMPLE_RECEIPT} dots={view === 'receipt58' ? 384 : 576} />
        </View>
      </View>
    );
  if (view === 'products')
    return (
      <ProductsListView
        rows={SAMPLE_PRODUCTS}
        loading={false}
        search=""
        onSearch={noop}
        onSubmitSearch={noop}
        onScan={noop}
        filter={{ kind: 'all' }}
        onFilter={noop}
        categories={[
          { id: '1', name: 'مشروبات', color: '#18A999', products: 12 },
          { id: '2', name: 'بقالة', color: '#F2A93B', products: 40 },
          { id: '3', name: 'ملابس', color: '#3B82C4', products: 8 },
        ]}
        summary={{ products: 186, lowStock: 7, stockValueMinor: 4_525_000 }}
        showValue
        currency="EGP"
        lang="ar"
        selecting={false}
        selected={new Set()}
        onPressRow={noop}
        onLongPressRow={noop}
        onEndReached={noop}
        onAdd={noop}
        onImport={noop}
        onMenu={noop}
        onCancelSelect={noop}
        onBulkPrice={noop}
        onBulkCategory={noop}
        canManage
        topInset={0}
      />
    );
  if (view === 'product')
    return (
      <ProductDetailView
        id="a"
        d={{
          name: 'شاي العروسة 250 جم',
          variantLabel: null,
          categoryName: 'مشروبات',
          imagePath: null,
          retailPriceMinor: 2200,
          wholesalePriceMinor: 2000,
          costMinor: 1850,
          trackStock: true,
          lowStockMilli: 12000,
          baseUnitName: 'قطعة',
          larger: { name: 'كرتونة', factorMilli: 24000, retailPriceMinor: 50000 },
          barcodes: ['6221234567890', '16221234567897'],
          level: { qtyMilli: 52000, avgCostMinor: 1862, valueMinor: 96824 },
          variants: [],
          movements: [
            { id: '1', type: 'ADJUST', qtyMilli: -2000, occurredAt: Date.now() - 3_600_000, reason: 'damaged' },
            { id: '2', type: 'COUNT', qtyMilli: 6000, occurredAt: Date.now() - 86_400_000, reason: 'count' },
            { id: '3', type: 'OPENING', qtyMilli: 48000, occurredAt: Date.now() - 3 * 86_400_000, reason: null },
          ],
        }}
        currency="EGP"
        lang="ar"
        canManage
        canAdjust
        canSeeCost
        onAdjust={noop}
        onEdit={noop}
        onAddVariant={noop}
        onDelete={noop}
      />
    );
  if (view === 'more')
    return (
      <MoreView
        userName="أحمد"
        userColor="#18A999"
        roleName="المالك"
        businessName="سوبر ماركت النور"
        account={[
          { key: 'u', icon: 'users', hue: 'amber', title: 'المستخدمين والصلاحيات', onPress: noop },
          { key: 's', icon: 'card', hue: 'primary', title: 'الاشتراك', value: 'احترافي', onPress: noop },
          { key: 'a', icon: 'list', hue: 'ink', title: 'سجل العمليات', onPress: noop },
        ]}
        app={[
          { key: 'sec', icon: 'shield', hue: 'sky', title: 'القفل والأمان', value: '5 دقيقة', onPress: noop },
          { key: 'l', icon: 'globe', hue: 'leaf', title: 'اللغة', value: 'العربية', onPress: noop },
        ]}
        onLock={noop}
        footer="دفترك 0.1.0 · عن التطبيق · A"
      />
    );
  return (
    <HomeView
      greeting="صباح الخير يا أحمد"
      userName="أحمد"
      userColor="#F2A93B"
      businessName="سوبر ماركت النور"
      dateLabel={dateLabel('ar')}
      planChip="فترة تجربة: فاضل 12 يوم"
      banner={view === 'home-banner' ? <Banner tone="warn" text="اشتراكك خلص. فاضل 4 يوم قبل ما ترجع للباقة المجانية." /> : null}
      tasks={[
        { key: 'o', title: 'حساب المالك اتعمل', icon: 'users', hue: 'primary', done: true },
        { key: 't', title: 'أضف موظفينك برقم سري لكل واحد', icon: 'users', hue: 'amber', done: false, onPress: noop },
        { key: 'l', title: 'فعّل الفتح بالبصمة', icon: 'fingerprint', hue: 'sky', done: false, onPress: noop },
        { key: 'p', title: 'أضف منتجاتك', icon: 'list', hue: 'rose', done: false, soon: true },
      ]}
      onLock={noop}
    />
  );
}
