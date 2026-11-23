/**
 * A4 invoice / quotation / return as HTML (printed to PDF by expo-print in ./pdf.ts).
 * Pure: no React / Expo imports, so the same builder feeds the PDF, the settings preview and tests.
 * Every piece of user text (shop, customer, items, notes) goes through esc() — the HTML is XSS-safe.
 */
import { formatMinor, formatQty, lineAmount } from '@daftarak/shared';
import type { ReceiptData } from './receiptData';
import { amountInWordsAr } from './tafqeet';
import { qrSvg } from './qr';

export const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Accept only a #RGB / #RRGGBB colour (it is interpolated into CSS). */
export function safeColor(c: string | null | undefined, fallback = '#1F4FD8'): string {
  return c && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c) ? c : fallback;
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** 23/11/2026 — digits only so bidi never reorders it. */
export const dayText = (ms: number) => {
  const d = new Date(ms);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const timeText = (ms: number) => {
  const d = new Date(ms);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};

export interface A4Options {
  /** Brand accent (falls back to the template's colour, then the app blue). */
  brand?: string;
  /** @font-face CSS (embedded Readex Pro in the app; empty in tests). */
  fontCss?: string;
  /** data: URI of the logo (file:// images do not load inside the print WebView). */
  logoSrc?: string | null;
  /** Payment method label (i18n in the app). */
  methodLabel?: (method: string) => string;
  /** Override the template style (settings preview). */
  style?: 'classic' | 'modern';
}

/** The document heading the owner expects for each kind. */
export function a4Title(d: ReceiptData): string {
  return d.title;
}

export function buildA4Html(d: ReceiptData, o: A4Options = {}): string {
  const tpl = d.template;
  const style = o.style ?? tpl.a4Style ?? 'modern';
  const brand = safeColor(o.brand ?? tpl.brandColor ?? undefined);
  const m = (v: number) => formatMinor(v);
  const cur = d.currency === 'SAR' ? 'ر.س' : 'ج.م';
  const quote = d.kind === 'QUOTATION';
  const method = o.methodLabel ?? ((x: string) => x);
  const showDisc = tpl.showDiscount && d.lines.some((l) => l.discountMinor > 0);
  const showCode = tpl.showItemCode && d.lines.some((l) => l.code);
  const vat = tpl.showTax && d.taxRatePct != null;
  const classic = style === 'classic';

  const rows = d.lines
    .map(
      (l, i) =>
        `<tr><td class="c">${i + 1}</td>${showCode ? `<td class="c code">${esc(l.code)}</td>` : ''}<td class="name">${esc(l.name)}</td><td class="c">${esc(l.unit)}</td><td class="c num">${formatQty(l.qtyMilli)}</td><td class="c num">${m(l.priceMinor)}</td>${showDisc ? `<td class="c num">${l.discountMinor ? m(l.discountMinor) : '—'}</td>` : ''}<td class="c num b">${m(l.totalMinor)}</td></tr>`,
    )
    .join('');

  const sub = d.lines.reduce((a, l) => a + lineAmount(l.priceMinor, l.qtyMilli), 0);
  const tot: string[] = [];
  if (d.discountMinor) tot.push(`<div class="r"><span>الإجمالي قبل الخصم</span><span class="num">${m(sub)}</span></div>`, `<div class="r"><span>الخصم</span><span class="num">-${m(d.discountMinor)}</span></div>`);
  if (vat) tot.push(`<div class="r"><span>الإجمالي بدون الضريبة</span><span class="num">${m(d.netMinor)}</span></div>`, `<div class="r"><span>ضريبة القيمة المضافة ${d.taxRatePct}%</span><span class="num">${m(d.taxMinor)}</span></div>`);
  if (d.roundingMinor) tot.push(`<div class="r"><span>تقريب</span><span class="num">${m(d.roundingMinor)}</span></div>`);
  tot.push(`<div class="r grand"><span>${quote ? 'إجمالي العرض' : 'الإجمالي المستحق'}</span><span class="num">${m(d.totalMinor)} ${cur}</span></div>`);
  if (!quote) {
    for (const p of d.payments) tot.push(`<div class="r"><span>${esc(method(p.method))}${p.label ? ` (${esc(p.label)})` : ''}</span><span class="num">${m(p.amountMinor)}</span></div>`);
    if (d.tenderedMinor > 0 && d.changeMinor > 0) tot.push(`<div class="r"><span>المدفوع نقداً</span><span class="num">${m(d.tenderedMinor)}</span></div>`, `<div class="r"><span>الباقي للعميل</span><span class="num">${m(d.changeMinor)}</span></div>`);
    if (d.creditMinor) tot.push(`<div class="r due"><span>المتبقي (آجل)</span><span class="num">${m(d.creditMinor)}</span></div>`);
  }

  const shop = [
    d.address ? `<div>${esc(d.address)}</div>` : '',
    d.phones.length ? `<div>هاتف: <bdi dir="ltr">${d.phones.map(esc).join(' · ')}</bdi></div>` : '',
    d.vatNumber ? `<div>الرقم الضريبي: <bdi dir="ltr">${esc(d.vatNumber)}</bdi></div>` : '',
  ].join('');

  const docMeta = [
    `<div><span>رقم ${quote ? 'العرض' : 'المستند'}</span><b dir="ltr">${esc(d.number) || '—'}</b></div>`,
    `<div><span>التاريخ</span><b dir="ltr">${dayText(d.date)} ${timeText(d.date)}</b></div>`,
    quote && d.validUntil ? `<div><span>صالح حتى</span><b dir="ltr">${dayText(d.validUntil)}</b></div>` : '',
    tpl.showCashier && d.cashier ? `<div><span>${quote ? 'أعده' : 'الكاشير'}</span><b>${esc(d.cashier)}</b></div>` : '',
  ].join('');

  const customer = d.customerName
    ? `<div class="box cust"><div class="lbl">${quote ? 'مقدَّم إلى' : 'العميل'}</div><div class="cname">${esc(d.customerName)}</div>${d.customerPhone ? `<div>هاتف: <bdi dir="ltr">${esc(d.customerPhone)}</bdi></div>` : ''}${tpl.showBalance && !quote && d.customerBalanceMinor ? `<div>رصيد العميل: <b class="num">${m(d.customerBalanceMinor)} ${cur}</b></div>` : ''}</div>`
    : `<div class="box cust"><div class="lbl">${quote ? 'مقدَّم إلى' : 'العميل'}</div><div class="cname">عميل نقدي</div></div>`;

  const words = tpl.showWords ? `<div class="words"><span class="lbl">المبلغ بالحروف</span>فقط ${esc(amountInWordsAr(d.totalMinor, d.currency))} لا غير</div>` : '';
  const notes = [d.note ? `<div class="note"><span class="lbl">ملاحظات</span>${esc(d.note)}</div>` : '', quote && tpl.quoteTerms ? `<div class="note"><span class="lbl">الشروط والأحكام</span>${esc(tpl.quoteTerms)}</div>` : ''].join('');
  const qr = tpl.showQr && d.qr ? `<div class="qr">${qrSvg(d.qr)}</div>` : '';
  const logo = tpl.showLogo && o.logoSrc ? `<img class="logo" src="${esc(o.logoSrc)}"/>` : '';

  const css = `${o.fontCss ?? ''}
@page{size:A4;margin:14mm 12mm 16mm;@bottom-center{content:"صفحة " counter(page) " من " counter(pages);font-family:'Readex',sans-serif;font-size:10px;color:#667085}}
*{box-sizing:border-box}html,body{margin:0}body{font-family:'Readex','Tahoma',sans-serif;color:#101828;font-size:12px;line-height:1.55}
.num{font-variant-numeric:tabular-nums;direction:ltr;unicode-bidi:isolate}.b{font-weight:700}.c,th.c,td.c{text-align:center}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.shop{display:flex;gap:12px;align-items:center}.logo{width:72px;height:72px;object-fit:contain}
.shop h1{margin:0;font-size:22px;line-height:1.3}.shop div{color:#475467;font-size:11.5px}
.doc{min-width:220px}.doc h2{margin:0 0 6px;font-size:22px}.doc div{display:flex;justify-content:space-between;gap:12px;font-size:11.5px;color:#475467}.doc b{color:#101828}
.hnote{margin-top:10px;padding:6px 10px;text-align:center;font-weight:700}
.info{display:flex;gap:12px;margin:14px 0 10px}.box{flex:1;padding:8px 12px}.lbl{display:block;font-size:10.5px;color:#667085;margin-bottom:2px}.cname{font-size:15px;font-weight:700}
table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{page-break-inside:avoid}
th{font-weight:700;padding:7px 6px;text-align:right;font-size:11.5px}td{padding:7px 6px;vertical-align:top}td.name{width:38%}td.code{font-size:10.5px;color:#475467}
.bottom{display:flex;gap:16px;margin-top:12px;align-items:flex-start;page-break-inside:avoid}.left{width:44%}.right{flex:1;display:flex;flex-direction:column;gap:8px}
.r{display:flex;justify-content:space-between;padding:4px 10px}.grand{font-size:16px;font-weight:700;padding:8px 10px}.due{color:#B42318;font-weight:700}
.words{padding:8px 10px;font-weight:700}.note{padding:6px 10px;white-space:pre-wrap;color:#344054}.qr{width:104px}
.sign{display:flex;gap:24px;margin-top:28px;page-break-inside:avoid}.sign div{flex:1;text-align:center;color:#475467;padding-top:34px}
.foot{margin-top:18px;text-align:center;color:#475467;font-size:11.5px}.brandline{margin-top:6px;text-align:center;color:#98A2B3;font-size:9.5px}
.void{color:#B42318;font-size:20px;font-weight:700;border:3px solid #B42318;display:inline-block;padding:2px 14px;border-radius:8px;transform:rotate(-6deg);margin-top:8px}
${
  classic
    ? `.head{border-bottom:3px double #101828;padding-bottom:10px}.shop h1{color:#101828}
.doc{border:1.5px solid #101828;padding:8px 10px}.doc h2{text-align:center;border-bottom:1px solid #101828;padding-bottom:4px}
.hnote{border:1px solid #101828}.box{border:1px solid #101828}
th{background:#F2F4F7;color:#101828;border:1px solid #101828}td{border:1px solid #101828}
.left{border:1px solid #101828}.grand{border-top:2px solid #101828;background:#F2F4F7}.words,.note{border:1px solid #101828}
.sign div{border-top:1px solid #101828}`
    : `.bar{height:10px;background:${brand};margin:0 0 14px;border-radius:0 0 6px 6px}.shop h1{color:${brand}}
.doc h2{color:${brand}}.hnote{background:${brand}14;color:${brand};border-radius:8px}
.box{background:#F8F9FC;border-radius:10px;border-inline-start:4px solid ${brand}}
th{background:${brand};color:#fff}th:first-child{border-start-start-radius:8px}th:last-child{border-start-end-radius:8px}
td{border-bottom:1px solid #EAECF0}tbody tr:nth-child(even) td{background:#F8F9FC}
.left{background:#F8F9FC;border-radius:10px;overflow:hidden}.grand{background:${brand};color:#fff}
.words{background:${brand}10;border-radius:8px;color:#101828}.note{background:#F8F9FC;border-radius:8px}
.sign div{border-top:1.5px dashed #98A2B3}`
}`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(d.title)} ${esc(d.number)}</title><style>${css}</style></head><body>
${classic ? '' : '<div class="bar"></div>'}
<div class="head"><div class="shop">${logo}<div><h1>${esc(d.businessName)}</h1>${shop}</div></div>
<div class="doc"><h2>${esc(a4Title(d))}</h2>${docMeta}</div></div>
${d.voided ? '<div class="void">ملغاة</div>' : ''}
${tpl.headerNote ? `<div class="hnote">${esc(tpl.headerNote)}</div>` : ''}
<div class="info">${customer}</div>
<table><thead><tr><th class="c">#</th>${showCode ? '<th class="c">الكود</th>' : ''}<th>الصنف</th><th class="c">الوحدة</th><th class="c">الكمية</th><th class="c">سعر الوحدة</th>${showDisc ? '<th class="c">الخصم</th>' : ''}<th class="c">الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="bottom"><div class="right">${words}${notes}${qr}</div><div class="left">${tot.join('')}</div></div>
<div class="sign"><div>${quote ? 'توقيع العميل بالموافقة' : 'توقيع المستلم'}</div><div>الختم والتوقيع</div></div>
${tpl.footer ? `<div class="foot">${esc(tpl.footer)}</div>` : ''}
<div class="brandline">كاشيرو</div>
</body></html>`;
}
