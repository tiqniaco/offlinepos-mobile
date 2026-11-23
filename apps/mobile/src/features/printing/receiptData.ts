/** Everything a receipt / PDF needs, built from the posted document (one source for print and PDF). */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { zatcaTimestamp, zatcaTlvBase64 } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { barcodes, business, products, users } from '../../db/schema';
import { getSale } from '../../domain/sales/sales';
import { partyBalance } from '../../domain/parties/customers';
import { loadSettings, resolveTemplate, type ReceiptTemplate } from '../../domain/settings/settings';
import { getParty } from '../../domain/parties/parties';
import { phoneLabel } from '../../lib/format';

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
  customerPhone?: string | null;
  /** Free note typed on the document. */
  note?: string | null;
  /** Quotations: valid until (ms). */
  validUntil?: number | null;
  /** Item # / barcode / SKU per line (printed when the template asks for it). */
  lines: { name: string; qtyMilli: number; unit: string; priceMinor: number; discountMinor: number; totalMinor: number; code?: string | null }[];
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
  template: Required<ReceiptTemplate>;
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
  const template = resolveTemplate(settings.receipt);
  const title = d.type === 'RETURN' ? (vatOn ? 'إشعار دائن / مرتجع' : 'مرتجع') : d.type === 'QUOTATION' ? 'عرض سعر' : (settings.invoiceTitleAr ?? (vatOn ? 'فاتورة ضريبية' : 'فاتورة'));
  const party = d.customerId ? await getParty(db, 'C', d.customerId).catch(() => null) : null;
  // SKU, else the first live barcode of the sold unit — only looked up when the template prints it.
  const codes = new Map<string, string>();
  if (template.showItemCode && s.lines.length) {
    const pids = [...new Set(s.lines.map((l) => l.productId))];
    for (const p of await db.select({ id: products.id, sku: products.sku }).from(products).where(inArray(products.id, pids))) if (p.sku) codes.set(p.id, p.sku);
    const puids = [...new Set(s.lines.map((l) => l.productUnitId))];
    for (const b of await db.select({ pu: barcodes.productUnitId, code: barcodes.code }).from(barcodes).where(and(inArray(barcodes.productUnitId, puids), isNull(barcodes.deletedAt)))) if (!codes.has(`u:${b.pu}`)) codes.set(`u:${b.pu}`, b.code);
  }
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
    // Shop phones print in the local form customers dial ("01012345678"), however they were saved.
    phones: (JSON.parse(b.phonesJson) as string[]).map((p) => phoneLabel(p)).filter(Boolean),
    vatNumber: vatOn ? b.vatNumber : null,
    logoPath: b.logoPath,
    cashier,
    customerName: d.customerName,
    customerBalanceMinor: d.customerId ? await partyBalance(db, 'C', d.customerId) : null,
    customerPhone: party?.mobile ? phoneLabel(party.mobile) : null,
    note: d.note,
    validUntil: d.type === 'QUOTATION' ? (d.createdAt + template.quoteValidDays * 86_400_000) : null,
    lines: s.lines.map((l) => ({ name: l.nameSnapshot, qtyMilli: l.qtyMilli, unit: l.unitNameSnapshot, priceMinor: l.unitPriceMinor, discountMinor: l.offerDiscountMinor + l.lineDiscountMinor + l.invoiceDiscountMinor, totalMinor: l.totalMinor, code: codes.get(l.productId) ?? codes.get(`u:${l.productUnitId}`) ?? null })),
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
    template,
  };
}
