/** A realistic sample invoice / quotation for the «شكل الفواتير» live preview (pure). */
import type { ReceiptTemplate } from '../../domain/settings/settings';
import type { ReceiptData } from './receiptData';

export interface SampleShop {
  name: string;
  address: string | null;
  phones: string[];
  vatNumber: string | null;
  logoPath: string | null;
  currency: 'EGP' | 'SAR';
}

const LINES = [
  { name: 'شاي ناعم 250 جم', code: '6221234500011', qtyMilli: 3000, unit: 'علبة', priceMinor: 4500, discountMinor: 0 },
  { name: 'سكر أبيض 1 كجم', code: '6221234500028', qtyMilli: 5000, unit: 'كيس', priceMinor: 3600, discountMinor: 0 },
  { name: 'زيت ذرة 800 مل', code: '6221234500035', qtyMilli: 2000, unit: 'زجاجة', priceMinor: 8950, discountMinor: 900 },
  { name: 'أرز مصري 5 كجم', code: 'SKU-104', qtyMilli: 1000, unit: 'شوال', priceMinor: 21000, discountMinor: 0 },
  { name: 'جبنة بيضاء 500 جم', code: '6221234500059', qtyMilli: 1500, unit: 'كجم', priceMinor: 9000, discountMinor: 0 },
];

export function sampleReceiptData(kind: 'INVOICE' | 'QUOTATION', template: Required<ReceiptTemplate>, shop: SampleShop, opts: { vatRatePct?: number | null; cashier?: string } = {}): ReceiptData {
  const lines = LINES.map((l) => ({ ...l, totalMinor: Math.round((l.priceMinor * l.qtyMilli) / 1000) - l.discountMinor }));
  const net = lines.reduce((a, l) => a + l.totalMinor, 0);
  const rate = opts.vatRatePct ?? null;
  const tax = rate ? Math.round((net * rate) / 100) : 0;
  const total = net + tax;
  const quote = kind === 'QUOTATION';
  const date = Date.now();
  const tendered = Math.ceil(total / 10000) * 10000;
  return {
    kind,
    title: quote ? 'عرض سعر' : rate ? 'فاتورة ضريبية' : 'فاتورة',
    number: quote ? 'Q-000017' : 'INV-000245',
    date,
    businessName: shop.name || 'سوبر ماركت النور',
    address: shop.address || 'القاهرة — مدينة نصر، شارع عباس العقاد',
    phones: shop.phones.length ? shop.phones : ['01012345678'],
    vatNumber: rate ? shop.vatNumber || '123-456-789' : null,
    logoPath: shop.logoPath,
    cashier: opts.cashier ?? 'محمد',
    customerName: 'أحمد محمود',
    customerPhone: '01123456789',
    customerBalanceMinor: quote ? null : 35_000,
    note: null,
    validUntil: quote ? date + template.quoteValidDays * 86_400_000 : null,
    lines,
    discountMinor: lines.reduce((a, l) => a + l.discountMinor, 0),
    netMinor: net,
    taxMinor: tax,
    taxRatePct: rate,
    roundingMinor: 0,
    totalMinor: total,
    creditMinor: 0,
    changeMinor: quote ? 0 : tendered - total,
    tenderedMinor: quote ? 0 : tendered,
    payments: quote ? [] : [{ method: 'cash', label: null, amountMinor: total }],
    voided: false,
    qr: null,
    currency: shop.currency,
    template,
  };
}

const MORE = ['مكرونة اسباجتي 400 جم', 'صابون غسيل أطباق ليمون 1 لتر', 'بسكويت بالشوكولاتة', 'عصير مانجو 1 لتر', 'تونة قطع 185 جم', 'لبن كامل الدسم 1 لتر'];

/** The same sample with many lines (two A4 pages) — to preview page breaks and the repeated table header. */
export function longSample(d: ReceiptData, count = 32): ReceiptData {
  const base = [...LINES, ...MORE.map((name, i) => ({ name, code: `62212345001${String(i).padStart(2, '0')}`, qtyMilli: 1000 * (1 + (i % 3)), unit: 'علبة', priceMinor: 1750 + i * 1325, discountMinor: 0 }))];
  const lines = Array.from({ length: count }, (_, i) => {
    const l = base[i % base.length]!;
    return { ...l, totalMinor: Math.round((l.priceMinor * l.qtyMilli) / 1000) - l.discountMinor };
  });
  const net = lines.reduce((a, l) => a + l.totalMinor, 0);
  const tax = d.taxRatePct ? Math.round((net * d.taxRatePct) / 100) : 0;
  const total = net + tax;
  const quote = d.kind === 'QUOTATION';
  const tendered = Math.ceil(total / 10000) * 10000;
  return {
    ...d,
    lines,
    discountMinor: lines.reduce((a, l) => a + l.discountMinor, 0),
    netMinor: net,
    taxMinor: tax,
    totalMinor: total,
    tenderedMinor: quote ? 0 : tendered,
    changeMinor: quote ? 0 : tendered - total,
    payments: quote ? [] : [{ method: 'cash', label: null, amountMinor: total }],
  };
}
