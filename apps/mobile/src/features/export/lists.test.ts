import i18n from 'i18next';
import ar from '../../i18n/ar.json';
import { reportSheet } from './report';
import { offersListDoc, partiesListDoc, phoneText, productsListDoc, purchasesListDoc, salesListDoc, shiftsListDoc, usersListDoc, vouchersListDoc } from './lists';
import type { BizHeader } from './fmt';

const b: BizHeader = { businessName: 'سوبر ماركت النور', address: 'المنصورة', phones: ['01012345678'], vatNumber: '123', currency: 'EGP' };
const at = new Date(2026, 10, 24, 14, 5).getTime();

beforeAll(async () => {
  await i18n.init({ resources: { ar: { translation: ar } }, lng: 'ar', fallbackLng: 'ar', interpolation: { escapeValue: false } });
});

describe('list report builders', () => {
  it('customers: local phones, balances in words, totals of what they owe', () => {
    const d = partiesListDoc('C', [
      { name: 'محمود', mobile: '201012345678', address: 'طلخا', creditLimitMinor: 200_000, balanceMinor: 12_000 },
      { name: 'سارة', mobile: null, address: null, creditLimitMinor: null, balanceMinor: -5_000 },
    ], b);
    expect(d.title).toBe('قائمة العملاء');
    expect(d.vatNumber).toBeNull();
    expect(d.rows[0]!.cells).toMatchObject({ mobile: '01012345678', balance: 'عليه 120.00 ج.م', limit: '2,000.00' });
    expect(d.rows[0]!.values).toMatchObject({ balance: 120, limit: 2000 });
    expect(d.rows[1]!.cells.balance).toBe('له 50.00 ج.م');
    expect(d.summary[1]!.value).toBe('120.00 ج.م');
    expect(d.totals.map((x) => x.value)).toEqual(['120.00 ج.م', '50.00 ج.م']);
    // Excel keeps the phone as text (the leading 0 survives) and amounts as numbers.
    const sheet = reportSheet(d);
    expect(sheet.find((r) => r[0] === 'محمود')).toEqual(['محمود', '01012345678', 'طلخا', 2000, 120]);
  });

  it('suppliers: no credit-limit column, balance from our side', () => {
    const d = partiesListDoc('S', [{ name: 'شركة', mobile: '201112345678', address: null, creditLimitMinor: null, balanceMinor: -30_000 }], b);
    expect(d.columns.map((c) => c.key)).toEqual(['name', 'mobile', 'address', 'balance']);
    expect(d.rows[0]!.cells.balance).toBe('له 300.00 ج.م');
    expect(d.rows[0]!.values!.balance).toBe(300);
  });

  it('sales: voided rows are shown muted but left out of the totals; returns subtract', () => {
    const d = salesListDoc(
      [
        { number: 'INV-1', type: 'INVOICE', status: 'POSTED', customerName: null, totalMinor: 10_000, creditMinor: 4_000, postedAt: at },
        { number: 'INV-2', type: 'INVOICE', status: 'VOIDED', customerName: 'منى', totalMinor: 99_900, creditMinor: 0, postedAt: at },
        { number: 'RET-1', type: 'RETURN', status: 'POSTED', customerName: null, totalMinor: 2_500, creditMinor: 0, postedAt: at },
      ],
      b,
      { range: { from: 20261101, to: 20261124 }, search: 'INV' },
    );
    expect(d.period).toBe('من 2026-11-01 إلى 2026-11-24 — بحث: INV');
    expect(d.rows[0]!.cells).toMatchObject({ date: '2026-11-24 14:05', customer: 'عميل نقدي', kind: 'آجل' });
    expect(d.rows[1]!.muted).toBe(true);
    expect(d.rows[2]!.values!.total).toBe(-25);
    expect(d.totals.at(-1)!.value).toBe('75.00 ج.م');
    expect(d.fileName).toBe('invoices-2026-11-01-2026-11-24');
  });

  it('purchases and vouchers: totals by direction', () => {
    const p = purchasesListDoc([{ number: 'PUR-1', type: 'PURCHASE', status: 'POSTED', supplierName: null, totalMinor: 50_000, paidMinor: 20_000, creditMinor: 30_000, postedAt: at }], b, { filterLabel: 'فواتير' });
    expect(p.rows[0]!.cells.supplier).toBe('مورد نقدي');
    expect(p.totals.map((x) => x.value)).toEqual(['500.00', '0.00', '300.00', '500.00 ج.م']);
    const v = vouchersListDoc(
      [
        { type: 'RECEIPT', status: 'POSTED', number: 'RCV-1', partyName: 'محمود', categoryName: null, method: 'cash', amountMinor: 3_000, postedAt: at, note: null },
        { type: 'EXPENSE', status: 'POSTED', number: 'EXP-1', partyName: null, categoryName: 'إيجار', method: 'cash', amountMinor: 1_000, postedAt: at, note: 'نوفمبر' },
        { type: 'OPENING_BALANCE', status: 'POSTED', number: 'OPB-1', partyName: 'سارة', categoryName: null, method: 'credit', amountMinor: 7_000, postedAt: at, note: null },
      ],
      b,
    );
    expect(v.rows.map((r) => r.cells.amount)).toEqual(['+30.00', '-10.00', '70.00']);
    expect(v.rows[1]!.sub).toEqual(['نوفمبر']);
    expect(v.totals.at(-1)!.value).toBe('20.00 ج.م');
  });

  it('shifts, offers, users, products', () => {
    const s = shiftsListDoc([{ number: 'SH-1', status: 'CLOSED', userName: 'أحمد', openedAt: at, closedAt: at, openingFloatMinor: 0, expectedCashMinor: 10_000, countedCashMinor: 9_500, differenceMinor: -500 }], b);
    expect(s.rows[0]!.cells.diff).toBe('-5.00');
    expect(s.totals.map((x) => x.value)).toEqual(['-5.00', '-5.00 ج.م']);
    const o = offersListDoc([{ name: 'خصم الجمعة', typeLabel: 'خصم %', summary: '10%', state: 'شغّال', startsDay: 20261101, endsDay: null, live: true }], b);
    expect(o.rows[0]!.cells).toMatchObject({ from: '2026-11-01', to: '' });
    const u = usersListDoc([{ name: 'علي', roleName: 'كاشير', isActive: false, lastLoginAt: null }], b);
    expect(u.rows[0]!.cells).toEqual({ name: 'علي', role: 'كاشير', status: 'موقوف', last: 'لسه ما دخلش' });
    expect(JSON.stringify(u)).not.toMatch(/pin|hash|salt/i);
    const row = { name: 'شاي', variantLabel: '250 جم', category: 'مشروبات', unitName: 'قطعة', barcode: '622', costMinor: 1_850, retailPriceMinor: 2_200, qtyMilli: 10_000, trackStock: true };
    const withCost = productsListDoc([row], b, { includeCost: true });
    expect(withCost.rows[0]!.cells.name).toBe('شاي - 250 جم');
    expect(withCost.summary[1]!.value).toBe('185.00 ج.م');
    const noCost = productsListDoc([row], b, { includeCost: false });
    expect(noCost.columns.some((c) => c.key === 'cost')).toBe(false);
    expect(noCost.summary).toHaveLength(1);
  });

  it('phoneText keeps local numbers and unknown digits', () => {
    expect(phoneText('966501234567')).toBe('0501234567');
    expect(phoneText('12345')).toBe('12345');
    expect(phoneText(null)).toBe('');
  });
});
