import { buildA4Html, esc, safeColor } from './a4';
import { sampleReceiptData } from './sample';
import { DEFAULT_RECEIPT } from '../../domain/settings/settings';

const shop = { name: 'سوبر ماركت النور', address: 'القاهرة', phones: ['01012345678'], vatNumber: null, logoPath: null, currency: 'EGP' as const };

describe('A4 HTML builder', () => {
  it('has the title, the totals and the amount in words', () => {
    const d = sampleReceiptData('INVOICE', DEFAULT_RECEIPT, shop);
    const html = buildA4Html(d);
    expect(html).toContain('<h2>فاتورة</h2>');
    expect(html).toContain('الإجمالي المستحق');
    expect(html).toContain('المبلغ بالحروف');
    expect(html).toContain('لا غير');
    expect(html).toContain('شاي ناعم 250 جم');
    expect(html).toContain('@page');
    expect(html).toContain('counter(page)');
    expect(html).toContain('توقيع المستلم');
  });

  it('quotation: title, validity, terms and no payment section', () => {
    const d = sampleReceiptData('QUOTATION', DEFAULT_RECEIPT, shop);
    const html = buildA4Html(d);
    expect(html).toContain('<h2>عرض سعر</h2>');
    expect(html).toContain('صالح حتى');
    expect(html).toContain(DEFAULT_RECEIPT.quoteTerms);
    expect(html).toContain('إجمالي العرض');
    expect(html).not.toContain('المدفوع نقداً');
    expect(html).not.toContain('الباقي للعميل');
  });

  it('classic and modern differ (modern has the brand bar)', () => {
    const d = sampleReceiptData('INVOICE', { ...DEFAULT_RECEIPT, brandColor: '#0E7C66' }, shop);
    expect(buildA4Html(d, { style: 'modern' })).toContain('class="bar"');
    expect(buildA4Html(d, { style: 'modern' })).toContain('#0E7C66');
    expect(buildA4Html(d, { style: 'classic' })).not.toContain('class="bar"');
  });

  it('escapes every piece of user text (XSS-safe)', () => {
    const evil = '<script>alert("x")</script>';
    const d = sampleReceiptData('INVOICE', { ...DEFAULT_RECEIPT, footer: evil, headerNote: '<img src=x onerror=1>' }, { ...shop, name: `محل ${evil}`, address: '"><b>x</b>' });
    d.customerName = `<b onmouseover='x'>عميل</b>`;
    d.note = '<iframe>';
    d.lines[0]!.name = '<svg onload=alert(1)>';
    d.lines[0]!.unit = '</td><td>';
    const html = buildA4Html(d);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<svg onload');
    expect(html).not.toContain('<iframe>');
    expect(html).not.toContain("<b onmouseover");
    expect(html).not.toContain('"><b>x</b>');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('&lt;svg onload=alert(1)&gt;');
  });

  it('only accepts hex brand colours (no CSS injection)', () => {
    expect(safeColor('#abc')).toBe('#abc');
    expect(safeColor('red;}body{display:none')).toBe('#1F4FD8');
    const d = sampleReceiptData('INVOICE', { ...DEFAULT_RECEIPT, brandColor: 'red;}</style><script>x</script>' }, shop);
    expect(buildA4Html(d)).not.toContain('<script>x');
    expect(esc(`a&b'`)).toBe('a&amp;b&#39;');
  });
});
