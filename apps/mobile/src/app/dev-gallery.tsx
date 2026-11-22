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
import { addDays, priceCart, zatcaTlvBase64, zatcaTimestamp } from '@daftarak/shared';
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
import { PartiesListView } from '../features/parties/PartiesListView';
import { StatementTable } from '../features/parties/StatementTable';
import { ReportView } from '../features/export/ReportView';
import { statementDoc, balanceWords } from '../features/export/builders';
import { ExportBar } from '../features/common/ExportBar';
import { Screen, Card, Text as UText, colors as C, fonts as F } from '../ui';
import { Segmented } from '../features/common/Segmented';
import { DashboardView } from '../features/reports/DashboardView';
import { ReportDocView } from '../features/reports/ReportDocView';
import { REPORTS } from '../features/reports/defs';
import type { Statement } from '../domain/parties/statement';

const SAMPLE_STATEMENT: Statement = {
  partyType: 'C',
  party: { id: 'c1', name: 'محمود علي', mobile: '201012345678', address: 'المعادي' },
  from: 20261101,
  to: 20261122,
  openingMinor: 25_000,
  closingMinor: 48_960,
  totalDebitMinor: 78_960,
  totalCreditMinor: 55_000,
  rows: [
    { key: '1', day: 20261103, at: 1, kind: 'invoice', number: 'INV-A-000041', docId: 'x', debitMinor: 31_920, creditMinor: 10_000, balanceMinor: 46_920, docTotalMinor: 31_920, paidNowMinor: 10_000, items: [{ name: 'زيت عافية 800 مل', qtyMilli: 4000, unit: 'زجاجة', priceMinor: 7980, totalMinor: 31_920 }] },
    { key: '2', day: 20261108, at: 2, kind: 'receipt', number: 'RCV-A-000007', docId: 'y', debitMinor: 0, creditMinor: 30_000, balanceMinor: 16_920, method: 'cash' },
    { key: '3', day: 20261115, at: 3, kind: 'invoice', number: 'INV-A-000058', docId: 'z', debitMinor: 47_040, creditMinor: 15_000, balanceMinor: 48_960, docTotalMinor: 47_040, paidNowMinor: 15_000, items: [{ name: 'شاي العروسة 250 جم', qtyMilli: 12000, unit: 'قطعة', priceMinor: 2200, totalMinor: 26_400 }, { name: 'أرز الضحى 1 كيلو', qtyMilli: 6000, unit: 'كيلو', priceMinor: 3440, totalMinor: 20_640 }] },
  ],
};
const SAMPLE_BIZ = { businessName: 'سوبر ماركت النور', address: 'القاهرة — المعادي', phones: ['201001234567'], vatNumber: null, currency: 'EGP' as const };

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
        priced={view === 'pos' ? priceCart({ lines: SAMPLE_CART.map((l) => ({ ...l, offerDiscountMinor: l.key === 'a' ? 2200 : 0, offerId: l.key === 'a' ? 'o' : null })), pricesIncludeVat: true, couponMinor: 1000 }) : null}
        offerNames={{ a: 'اشتري 2 وخد 1' }}
        couponLabel={view === 'pos' ? 'كوبون: EID10' : null}
        onCoupon={noop}
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
  if (view === 'parties' || view === 'suppliers')
    return (
      <PartiesListView
        topInset={0}
        type={view === 'parties' ? 'C' : 'S'}
        rows={
          view === 'parties'
            ? [
                { id: 'c1', name: 'محمود علي', mobile: '201012345678', owedMinor: 48_960, lateDays: null },
                { id: 'c2', name: 'سوبر ماركت الهدى', mobile: '201112223334', owedMinor: 125_000 },
                { id: 'c3', name: 'أم كريم', mobile: null, owedMinor: 0 },
                { id: 'c4', name: 'مطعم الشيف', mobile: '201234567890', owedMinor: -5_000 },
              ]
            : [
                { id: 's1', name: 'شركة النيل للتوريدات', mobile: '201000000001', owedMinor: 340_000 },
                { id: 's2', name: 'مخازن الأمل', mobile: null, owedMinor: 0 },
              ]
        }
        totalOwedMinor={view === 'parties' ? 173_960 : 340_000}
        count={view === 'parties' ? 4 : 2}
        search=""
        filter="all"
        currency="EGP"
        lang="ar"
        canAdd
        onType={noop}
        onSearch={noop}
        onFilter={noop}
        onOpen={noop}
        onAdd={noop}
        onRemind={noop}
      />
    );
  if (view === 'statement')
    return (
      <Screen back title="كشف حساب عميل" subtitle="محمود علي">
        <Segmented value="detailed" onChange={noop} options={[{ value: 'summary', label: 'مختصر' }, { value: 'detailed', label: 'مفصّل بالأصناف' }]} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Card style={{ flex: 1 }}>
            <UText variant="caption">رصيد أول المدة</UText>
            <UText style={{ fontFamily: F.bold, fontSize: 15, lineHeight: 22, color: C.ink.DEFAULT }}>{balanceWords('C', 25_000, 'EGP')}</UText>
          </Card>
          <Card style={{ flex: 1, backgroundColor: C.primary[50] }}>
            <UText variant="caption">الرصيد الحالي</UText>
            <UText style={{ fontFamily: F.bold, fontSize: 15, lineHeight: 22, color: C.primary[800] }}>{balanceWords('C', 48_960, 'EGP')}</UText>
          </Card>
        </View>
        <ExportBar build={() => statementDoc(SAMPLE_STATEMENT, SAMPLE_BIZ, true)} />
        <StatementTable st={SAMPLE_STATEMENT} />
      </Screen>
    );
  if (view === 'reports')
    return (
      <DashboardView
        d={{
          todaySalesMinor: 486_050, todayInvoices: 23, todayProfitMinor: 121_400, monthSalesMinor: 9_843_200, monthProfitMinor: 2_311_000,
          receivablesMinor: 173_960, payablesMinor: 340_000, lowStock: 7, stockValueMinor: 18_420_000,
          last30: Array.from({ length: 30 }, (_, i) => ({ day: addDays(20261024, i), salesMinor: 250_000 + Math.round(Math.sin(i / 3) * 90_000) + i * 4000 })),
          topItems: [
            { name: 'شاي العروسة 250 جم', qtyMilli: 184_000, salesMinor: 404_800 },
            { name: 'زيت عافية 800 مل', qtyMilli: 61_000, salesMinor: 454_450 },
            { name: 'أرز الضحى 1 كيلو', qtyMilli: 95_000, salesMinor: 332_500 },
          ],
        }}
        currency="EGP"
        lang="ar"
        showProfit
        reports={REPORTS}
        locked={(r) => r.id === 'expiring'}
        onOpen={noop}
      />
    );
  if (view === 'report')
    return (
      <Screen back title="المبيعات بالصنف" subtitle="من 2026-11-01 إلى 2026-11-22">
        <Segmented value="month" onChange={noop} options={[{ value: 'week', label: 'آخر 7 أيام' }, { value: 'month', label: 'الشهر ده' }, { value: 'year', label: 'السنة دي' }]} />
        <ExportBar build={() => statementDoc(SAMPLE_STATEMENT, SAMPLE_BIZ, false)} kinds={['pdf', 'excel', 'print', 'whatsapp']} />
        <ReportDocView
          d={{
            title: 'المبيعات بالصنف', businessName: 'سوبر ماركت النور', fileName: 'x',
            summary: [{ label: 'المبيعات', value: '98,432.00', strong: true }, { label: 'الربح', value: '23,110.00' }],
            columns: [{ key: 'name', label: 'الصنف' }, { key: 'qty', label: 'الكمية', num: true }, { key: 'sales', label: 'المبيعات', num: true }, { key: 'profit', label: 'الربح', num: true }],
            rows: [
              ['زيت عافية 800 مل', '610', '45,445.00', '8,905.00'], ['شاي العروسة 250 جم', '1,840', '40,480.00', '7,360.00'], ['أرز الضحى 1 كيلو', '950', '33,250.00', '5,700.00'],
              ['جبنة دومتي 500 جم', '312', '18,720.00', '4,120.00'], ['تيشيرت قطن XL', '41', '10,250.00', '3,690.00'], ['سكر 1 كيلو', '420', '12,600.00', '1,890.00'],
            ].map(([name, qty, sales, profit]) => ({ cells: { name: name!, qty: qty!, sales: sales!, profit: profit! } })),
            totals: [{ label: 'المبيعات', value: '98,432.00', strong: true }, { label: 'الضريبة', value: '12,088.00' }, { label: 'الخصومات', value: '2,140.00' }, { label: 'الربح', value: '23,110.00', strong: true }],
          }}
        />
      </Screen>
    );
  if (view === 'statement58')
    return (
      <View style={{ padding: 16, backgroundColor: '#ddd', alignItems: 'center' }}>
        <ReportView d={statementDoc(SAMPLE_STATEMENT, SAMPLE_BIZ, true)} dots={384} />
      </View>
    );
  if (view === 'more')
    return (
      <MoreView
        userName="أحمد"
        userColor="#18A999"
        roleName="المالك"
        businessName="سوبر ماركت النور"
        money={[
          { key: 'p', icon: 'cart', hue: 'primary', title: 'المشتريات', onPress: noop },
          { key: 'v', icon: 'receipt', hue: 'leaf', title: 'سندات القبض والصرف', onPress: noop },
          { key: 'e', icon: 'wallet', hue: 'rose', title: 'المصروفات', onPress: noop },
          { key: 'sh', icon: 'clock', hue: 'ink', title: 'الوردية والخزنة', onPress: noop },
        ]}
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
      onSell={noop}
      stats={[
        { key: 's', label: '23 فاتورة النهارده', value: '4,860.50 ج.م', icon: 'card', hue: 'primary' },
        { key: 'c', label: 'فلوسك برا', value: '1,739.60 ج.م', icon: 'users', hue: 'rose' },
        { key: 'l', label: 'ناقص في المخزن', value: '7', icon: 'warning', hue: 'amber' },
      ]}
      alerts={<Banner tone="warn" text="3 عميل متأخرين في الدفع — ابعتلهم تذكير" />}
      quick={[
        { key: 'collect', icon: 'arrowIn', hue: 'leaf', label: 'تحصيل', onPress: noop },
        { key: 'purchase', icon: 'cart', hue: 'primary', label: 'فاتورة شراء', onPress: noop },
        { key: 'pay', icon: 'arrowOut', hue: 'amber', label: 'دفع لمورد', onPress: noop },
        { key: 'expense', icon: 'wallet', hue: 'rose', label: 'مصروف', onPress: noop },
        { key: 'statement', icon: 'receipt', hue: 'sky', label: 'كشف حساب', onPress: noop },
        { key: 'customer', icon: 'users', hue: 'primary', label: 'عميل جديد', onPress: noop },
        { key: 'product', icon: 'box', hue: 'amber', label: 'منتج جديد', onPress: noop },
        { key: 'shift', icon: 'clock', hue: 'ink', label: 'الوردية', onPress: noop },
      ]}
    />
  );
}
