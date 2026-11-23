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

/** #RGB → #RRGGBB, so an alpha suffix (`${brand}14`) is always a valid colour. */
const hex6 = (c: string) => (c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c);

/** The family name the embedded font is registered under (see a4FontFaceCss). */
export const A4_FONT = 'KashiroDoc';

/** @font-face CSS for the embedded document font (regular + bold, base64 TTF). Empty input → empty CSS. */
export function a4FontFaceCss(regularB64: string | null | undefined, boldB64?: string | null): string {
  const face = (b64: string, w: number) => `@font-face{font-family:'${A4_FONT}';font-weight:${w};font-style:normal;src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
  return [regularB64 ? face(regularB64, 400) : '', boldB64 ? face(boldB64, 700) : ''].join('');
}

/**
 * A safe, readable PDF file name: «فاتورة INV-000245 - سوبر ماركت النور.pdf».
 * Strips characters that are illegal on Android/iOS/Windows file systems, bidi/control marks and leading dots,
 * collapses spaces and caps the length (file systems allow 255 bytes; Arabic is 2 bytes per letter).
 */
export function pdfFileName(title: string, number?: string | null, shop?: string | null): string {
  const clean = (x: string | null | undefined) =>
    String(x ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const main = [clean(title), clean(number)].filter(Boolean).join(' ');
  const s = clean(shop);
  let base = [main, s].filter(Boolean).join(' - ').replace(/^[.\s-]+/, '').slice(0, 90).trim();
  if (!base) base = 'document';
  return `${base}.pdf`;
}

export interface A4Options {
  /** Brand accent (falls back to the template's colour, then the app blue). */
  brand?: string;
  /** @font-face CSS from a4FontFaceCss() (embedded app font); empty → system Arabic fonts. */
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
  const brand = hex6(safeColor(o.brand ?? tpl.brandColor ?? undefined));
  const m = (v: number) => formatMinor(v);
  const cur = d.currency === 'SAR' ? 'ر.س' : 'ج.م';
  const quote = d.kind === 'QUOTATION';
  const ret = d.kind === 'RETURN';
  const AR_METHODS: Record<string, string> = { cash: 'نقدي', card: 'كارت', wallet: 'محفظة', bank: 'تحويل بنكي', credit: 'آجل' };
  const method = o.methodLabel ?? ((x: string) => AR_METHODS[x] ?? x);
  const showDisc = tpl.showDiscount && d.lines.some((l) => l.discountMinor > 0);
  const showCode = tpl.showItemCode && d.lines.some((l) => l.code);
  const vat = tpl.showTax && d.taxRatePct != null;
  const classic = style === 'classic';
  /** A number (or date) isolated as LTR so the Arabic bidi never reorders its digits / sign. */
  const n = (s: string, cls = '') => `<bdi class="num${cls ? ` ${cls}` : ''}" dir="ltr">${s}</bdi>`;
  const money = (v: number) => `${n(m(v))} <span class="cur">${cur}</span>`;

  // Column widths (%): # 5, code 10, unit 9, qty 8, price 12, discount 10, total 13 — the name takes the rest.
  const cols = [`<col style="width:5%"/>`, showCode ? `<col style="width:10%"/>` : '', `<col/>`, `<col style="width:9%"/>`, `<col style="width:8%"/>`, `<col style="width:12%"/>`, showDisc ? `<col style="width:10%"/>` : '', `<col style="width:13%"/>`].join('');
  const rows = d.lines
    .map(
      (l, i) =>
        `<tr><td class="c idx">${n(String(i + 1))}</td>${showCode ? `<td class="c code">${l.code ? n(esc(l.code)) : ''}</td>` : ''}<td class="name">${esc(l.name)}</td><td class="c">${esc(l.unit)}</td><td class="c">${n(formatQty(l.qtyMilli))}</td><td class="c">${n(m(l.priceMinor))}</td>${showDisc ? `<td class="c">${l.discountMinor ? n(m(l.discountMinor)) : '<span class="dim">—</span>'}</td>` : ''}<td class="c b">${n(m(l.totalMinor))}</td></tr>`,
    )
    .join('');

  const sub = d.lines.reduce((a, l) => a + lineAmount(l.priceMinor, l.qtyMilli), 0);
  const row = (label: string, value: string, cls = '') => `<div class="r${cls ? ` ${cls}` : ''}"><span>${label}</span>${value}</div>`;
  const tot: string[] = [];
  if (d.discountMinor) tot.push(row('الإجمالي قبل الخصم', n(m(sub))), row('الخصم', n(`-${m(d.discountMinor)}`)));
  if (vat) tot.push(row('الإجمالي بدون الضريبة', n(m(d.netMinor))), row(`ضريبة القيمة المضافة ${n(`${d.taxRatePct}%`)}`, n(m(d.taxMinor))));
  if (d.roundingMinor) tot.push(row('تقريب', n(m(d.roundingMinor))));
  tot.push(row(quote ? 'إجمالي العرض' : ret ? 'إجمالي المرتجع' : 'الإجمالي المستحق', `<span>${money(d.totalMinor)}</span>`, 'grand'));
  const pays: string[] = [];
  if (!quote) {
    for (const p of d.payments) pays.push(row(`${esc(method(p.method))}${p.label ? ` (${esc(p.label)})` : ''}`, n(m(p.amountMinor))));
    if (d.tenderedMinor > 0 && d.changeMinor > 0) pays.push(row('المدفوع نقداً', n(m(d.tenderedMinor))), row('الباقي للعميل', n(m(d.changeMinor))));
    if (d.creditMinor) pays.push(row('المتبقي (آجل)', n(m(d.creditMinor)), 'due'));
  }

  const shop = [
    d.address ? `<div>${esc(d.address)}</div>` : '',
    d.phones.length ? `<div>هاتف: ${d.phones.map((p) => n(esc(p))).join(' <span class="dim">·</span> ')}</div>` : '',
    d.vatNumber ? `<div>الرقم الضريبي: ${n(esc(d.vatNumber))}</div>` : '',
  ].join('');

  const meta = (k: string, v: string) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const docMeta = [
    meta(`رقم ${quote ? 'العرض' : ret ? 'المرتجع' : 'الفاتورة'}`, `<b>${n(esc(d.number) || '—')}</b>`),
    meta('التاريخ', n(`${dayText(d.date)} &nbsp;${timeText(d.date)}`)),
    quote && d.validUntil ? meta('صالح حتى', n(dayText(d.validUntil))) : '',
    tpl.showCashier && d.cashier ? meta(quote ? 'أعده' : 'الكاشير', esc(d.cashier)) : '',
  ].join('');

  const custLines = d.customerName
    ? [
        d.customerPhone ? `<div>هاتف: ${n(esc(d.customerPhone))}</div>` : '',
        tpl.showBalance && !quote && d.customerBalanceMinor ? `<div>رصيد العميل: <b>${money(d.customerBalanceMinor)}</b></div>` : '',
      ].join('')
    : '';
  const customer = `<div class="box cust"><div class="lbl">${quote ? 'مقدَّم إلى' : 'العميل'}</div><div class="cname">${d.customerName ? esc(d.customerName) : 'عميل نقدي'}</div>${custLines ? `<div class="cmeta">${custLines}</div>` : ''}</div>`;

  const words = tpl.showWords ? `<div class="words"><span class="lbl">المبلغ بالحروف</span>فقط ${esc(amountInWordsAr(d.totalMinor, d.currency))} لا غير</div>` : '';
  const notes = [d.note ? `<div class="note"><span class="lbl">ملاحظات</span>${esc(d.note)}</div>` : '', quote && tpl.quoteTerms ? `<div class="note"><span class="lbl">الشروط والأحكام</span>${esc(tpl.quoteTerms)}</div>` : ''].join('');
  const qr = tpl.showQr && d.qr ? `<div class="qr">${qrSvg(d.qr)}</div>` : '';
  const logo = tpl.showLogo && o.logoSrc ? `<img class="logo" src="${esc(o.logoSrc)}" alt=""/>` : '';
  const ff = `'${A4_FONT}','Readex','IBM Plex Sans Arabic','Noto Sans Arabic','Noto Naskh Arabic','Segoe UI','Tahoma',sans-serif`;

  const ink = '#101828';
  const mute = '#475467';
  const line = classic ? '#344054' : '#E4E7EC';
  const css = `${o.fontCss ?? ''}
@page{size:A4;margin:14mm 12mm 16mm;@bottom-center{content:"صفحة " counter(page) " من " counter(pages);font-family:${ff};font-size:8pt;color:#667085}}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
html,body{margin:0;padding:0;background:#fff}
body{font-family:${ff};color:${ink};font-size:10.5pt;line-height:1.6;font-feature-settings:"tnum" 1,"lnum" 1}
.doc-page{width:100%;max-width:186mm;margin:0 auto}
.num{font-variant-numeric:tabular-nums lining-nums;unicode-bidi:isolate;direction:ltr;white-space:nowrap}
.b{font-weight:700}.c{text-align:center}.dim{color:#98A2B3}.cur{font-size:.85em;color:${mute};font-weight:400}
.lbl{display:block;font-size:8.5pt;color:#667085;font-weight:400;margin-bottom:2px;letter-spacing:0}
/* header: shop (right) · document (left), both aligned to the top */
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:12px}
.shop{display:flex;gap:12px;align-items:flex-start;flex:1;min-width:0}
.logo{width:64px;height:64px;object-fit:contain;flex:none}
.shop h1{margin:0 0 4px;font-size:16pt;line-height:1.35;font-weight:700}
.shop .sub{font-size:9pt;color:${mute};line-height:1.65}
.docbox{flex:none;width:68mm}
.docbox h2{margin:0 0 8px;font-size:20pt;line-height:1.25;font-weight:700}
.docbox table{width:100%;border-collapse:collapse;font-size:9pt}
.docbox th{font-weight:400;color:#667085;text-align:right;padding:2px 0;white-space:nowrap}
.docbox td{text-align:left;padding:2px 0;color:${ink}}
.hnote{margin:0 0 12px;padding:8px 12px;text-align:center;font-weight:700;font-size:10pt}
.void{color:#B42318;font-size:16pt;font-weight:700;border:2px solid #B42318;display:inline-block;padding:2px 14px;border-radius:6px;transform:rotate(-4deg);margin:0 0 12px}
.box{padding:10px 12px}
.cust{margin:0 0 16px;display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 24px}
.cust .lbl{flex-basis:100%;margin:0}
.cname{font-size:12pt;font-weight:700;line-height:1.4}
.cmeta{display:flex;gap:4px 24px;flex-wrap:wrap;font-size:9.5pt;color:${mute}}.cmeta b{color:${ink}}
/* items */
table.items{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10pt}
table.items thead{display:table-header-group}
table.items tr{page-break-inside:avoid;break-inside:avoid}
table.items th{font-weight:700;font-size:9pt;padding:9px 6px;text-align:center;line-height:1.35;vertical-align:middle}
table.items th.name{text-align:right}
table.items td{padding:7px 6px;vertical-align:top;line-height:1.5}
table.items td.name{text-align:right;overflow-wrap:anywhere;word-break:normal}
table.items td.code{font-size:8.5pt;color:${mute};overflow-wrap:anywhere}
table.items td.idx{color:#667085}
/* bottom: notes/QR (right) · totals + words (left) */
.bottom{display:flex;gap:16px;margin-top:16px;align-items:flex-start;page-break-inside:avoid;break-inside:avoid}
.side{flex:1;display:flex;flex-direction:column;gap:12px;min-width:0}
.sums{width:44%;flex:none;display:flex;flex-direction:column;gap:12px}
.totals{font-size:10.5pt}
.r{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 12px}
.totals .r+.r{border-top:1px solid ${line}}
.totals .r:not(.grand){font-size:10.5pt}
.grand{font-size:15pt;font-weight:700;padding:10px 12px}.grand .cur{color:inherit;font-weight:700}
.pays{font-size:9.5pt;color:#344054}.pays .r{padding:4px 12px}
.due{color:#B42318;font-weight:700}
.words{padding:10px 12px;font-weight:700;font-size:10pt;line-height:1.7}
.note{padding:10px 12px;white-space:pre-wrap;color:#344054;font-size:9.5pt}
.qr{width:96px}.qr svg{width:96px;height:96px;display:block}
.sign{display:flex;gap:48px;margin-top:40px;page-break-inside:avoid;break-inside:avoid}
.sign div{flex:1;text-align:center;font-size:9.5pt;color:${mute}}
.sign div::after{content:"";display:block;margin-top:40px;border-top:1px ${classic ? 'solid #344054' : 'dashed #98A2B3'}}
.foot{margin-top:24px;text-align:center;color:${mute};font-size:9pt;line-height:1.6;page-break-inside:avoid}
.brandline{margin-top:4px;text-align:center;color:#98A2B3;font-size:7.5pt}
${
  classic
    ? `.head{border-bottom:2.5px double ${ink};margin-bottom:16px}
.docbox{border:1px solid ${ink};padding:8px 12px 10px}.docbox h2{text-align:center;border-bottom:1px solid ${ink};padding-bottom:6px;font-size:18pt}
.hnote{border:1px solid ${ink}}.box{border:1px solid ${ink}}
table.items th{background:#F2F4F7;color:${ink};border:1px solid ${ink}}
table.items td{border:1px solid #344054}
.totals,.pays{border:1px solid ${ink}}.grand{border-top:1.5px solid ${ink}!important;background:#F2F4F7}
.words,.note{border:1px solid ${ink}}`
    : `.bar{height:5px;background:${brand};border-radius:3px;margin:0 0 16px}
.shop h1{color:${ink}}.docbox h2{color:${brand}}
.head{border-bottom:1px solid #E4E7EC;margin-bottom:16px}
.hnote{background:${brand}12;color:${brand};border-radius:8px}
.box{background:#F8F9FC;border-radius:8px;border-inline-start:3px solid ${brand}}
table.items th{background:${brand}14;color:${ink};border-bottom:1.5px solid ${brand}}
table.items td{border-bottom:1px solid #EAECF0}
table.items tbody tr:nth-child(even) td{background:#FAFBFC}
.totals{background:#F8F9FC;border-radius:8px;overflow:hidden;border:1px solid #EAECF0}
.grand{background:${brand};color:#fff;border-top:0!important}.grand .cur{color:#fff}
.pays{border:1px solid #EAECF0;border-radius:8px}.pays .r+.r{border-top:1px solid #F2F4F7}
.words{background:${brand}0D;border-radius:8px;border:1px solid ${brand}33}
.note{background:#F8F9FC;border-radius:8px}`
}`;

  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(d.title)} ${esc(d.number)}</title><style>${css}</style></head><body><div class="doc-page">
${classic ? '' : '<div class="bar"></div>'}
<div class="head"><div class="shop">${logo}<div><h1>${esc(d.businessName)}</h1><div class="sub">${shop}</div></div></div>
<div class="docbox"><h2>${esc(a4Title(d))}</h2><table>${docMeta}</table></div></div>
${d.voided ? '<div class="void">ملغاة</div>' : ''}
${tpl.headerNote ? `<div class="hnote">${esc(tpl.headerNote)}</div>` : ''}
${customer}
<table class="items"><colgroup>${cols}</colgroup><thead><tr><th>#</th>${showCode ? '<th>الكود</th>' : ''}<th class="name">الصنف</th><th>الوحدة</th><th>الكمية</th><th>سعر الوحدة</th>${showDisc ? '<th>الخصم</th>' : ''}<th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="bottom"><div class="side">${notes}${qr}</div><div class="sums"><div class="totals">${tot.join('')}</div>${pays.length ? `<div class="pays">${pays.join('')}</div>` : ''}${words}</div></div>
<div class="sign"><div>${quote ? 'توقيع العميل بالموافقة' : 'توقيع المستلم'}</div><div>الختم والتوقيع</div></div>
${tpl.footer ? `<div class="foot">${esc(tpl.footer)}</div>` : ''}
<div class="brandline">كاشيرو</div>
</div></body></html>`;
}
