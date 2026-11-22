/** Everything a receipt / PDF needs, built from the posted document (one source for print and PDF). */
import { eq } from 'drizzle-orm';
import { zatcaTimestamp, zatcaTlvBase64 } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { business, users } from '../../db/schema';
import { getSale } from '../../domain/sales/sales';
import { partyBalance } from '../../domain/parties/customers';
import { loadSettings, DEFAULT_RECEIPT, type ReceiptTemplate } from '../../domain/settings/settings';

export interface ReceiptData {
  kind: 'INVOICE' | 'RETURN' | 'QUOTATION';
  title: string;
  number: string;
  date: number;
  businessName: string;
  address: string | null;
  phones: string[];
  vatNumber: string | null;
  logoPath: string | null;
  cashier: string | null;
  customerName: string | null;
  customerBalanceMinor: number | null;
  lines: { name: string; qtyMilli: number; unit: string; priceMinor: number; discountMinor: number; totalMinor: number }[];
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  taxRatePct: number | null;
  roundingMinor: number;
  totalMinor: number;
  creditMinor: number;
  changeMinor: number;
  tenderedMinor: number;
  payments: { method: string; label: string | null; amountMinor: number }[];
  voided: boolean;
  qr: string | null;
  currency: 'EGP' | 'SAR';
  template: ReceiptTemplate;
}

export async function buildReceiptData(docId: string): Promise<ReceiptData> {
  const db = getDb();
  const s = await getSale(db, docId);
  if (!s) throw new Error('not found');
  const b = (await db.select().from(business).limit(1))[0]!;
  const settings = await loadSettings(db);
  const d = s.doc;
  const cashier = d.cashierId ? ((await db.select({ name: users.name }).from(users).where(eq(users.id, d.cashierId)).limit(1))[0]?.name ?? null) : null;
  const vatOn = !!settings.vatRegistered && d.taxMinor > 0;
  const title = d.type === 'RETURN' ? 'إشعار دائن / مرتجع' : d.type === 'QUOTATION' ? 'عرض سعر' : (settings.invoiceTitleAr ?? 'فاتورة');
  const qr =
    settings.zatcaQr && b.vatNumber && d.type !== 'QUOTATION'
      ? zatcaTlvBase64({ sellerName: b.name, vatNumber: b.vatNumber, timestamp: zatcaTimestamp(d.postedAt ?? d.createdAt), totalWithVatMinor: d.totalMinor, vatMinor: d.taxMinor })
      : null;
  return {
    kind: d.type,
    title,
    number: d.number ?? '',
    date: d.postedAt ?? d.createdAt,
    businessName: b.name,
    address: b.address,
    phones: JSON.parse(b.phonesJson) as string[],
    vatNumber: vatOn ? b.vatNumber : null,
    logoPath: b.logoPath,
    cashier,
    customerName: d.customerName,
    customerBalanceMinor: d.customerId ? await partyBalance(db, 'C', d.customerId) : null,
    lines: s.lines.map((l) => ({ name: l.nameSnapshot, qtyMilli: l.qtyMilli, unit: l.unitNameSnapshot, priceMinor: l.unitPriceMinor, discountMinor: l.offerDiscountMinor + l.lineDiscountMinor + l.invoiceDiscountMinor, totalMinor: l.totalMinor })),
    discountMinor: d.offerDiscountMinor + d.lineDiscountMinor + d.couponDiscountMinor + d.invoiceDiscountMinor,
    netMinor: d.netMinor,
    taxMinor: d.taxMinor,
    taxRatePct: vatOn && s.lines[0] ? s.lines[0].taxRateBp / 100 : null,
    roundingMinor: d.roundingMinor,
    totalMinor: d.totalMinor,
    creditMinor: d.creditMinor,
    changeMinor: d.changeMinor,
    tenderedMinor: d.cashTenderedMinor,
    payments: s.payments.map((p) => ({ method: p.method, label: p.label, amountMinor: p.amountMinor })),
    voided: d.status === 'VOIDED',
    qr,
    currency: b.currency,
    template: { ...DEFAULT_RECEIPT, ...(settings.receipt ?? {}) },
  };
}
