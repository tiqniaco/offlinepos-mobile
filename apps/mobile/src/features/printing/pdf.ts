/**
 * A4 invoice / quotation / return as HTML → expo-print PDF. Arabic shaping is handled by the WebView;
 * the Readex Pro font is embedded as a data URI so the PDF looks the same on every phone.
 */
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import i18n from 'i18next';
import { formatMinor, formatQty } from '@daftarak/shared';
import { colors } from '../../ui';
import type { ReceiptData } from './receiptData';
import { qrSvg } from './qr';

let fontCss: string | null = null;

export async function embeddedFontCss(): Promise<string> {
  if (fontCss) return fontCss;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const f = require('@expo-google-fonts/readex-pro');
    const face = async (mod: number, weight: number) => {
      const a = Asset.fromModule(mod);
      await a.downloadAsync();
      const b64 = await new File(a.localUri ?? a.uri).base64();
      return `@font-face{font-family:'Readex';font-weight:${weight};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
    };
    fontCss = (await face(f.ReadexPro_400Regular, 400)) + (await face(f.ReadexPro_700Bold, 700));
  } catch {
    fontCss = '';
  }
  return fontCss;
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function receiptHtml(d: ReceiptData): Promise<string> {
  const t = i18n.t.bind(i18n);
  const m = (v: number) => formatMinor(v);
  const cur = d.currency === 'SAR' ? 'ر.س' : 'ج.م';
  const brand = colors.primary['600'];
  const date = new Date(d.date).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
  const rows = d.lines
    .map(
      (l, i) => `<tr><td>${i + 1}</td><td class="name">${esc(l.name)}</td><td>${formatQty(l.qtyMilli)} ${esc(l.unit)}</td><td>${m(l.priceMinor)}</td>${d.template.showDiscount ? `<td>${l.discountMinor ? m(l.discountMinor) : '—'}</td>` : ''}<td class="b">${m(l.totalMinor)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<style>${await embeddedFontCss()}
@page{size:A4;margin:16mm 14mm}
*{box-sizing:border-box}body{font-family:'Readex',sans-serif;color:#101828;font-size:12.5px;margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${brand};padding-bottom:12px}
.biz h1{margin:0;font-size:24px;color:${brand}}.biz div{color:#475467;margin-top:2px}
.doc{text-align:left}.doc h2{margin:0;font-size:20px}.doc div{color:#475467;margin-top:2px;direction:ltr}
.meta{display:flex;gap:24px;margin:14px 0;color:#475467}.meta b{color:#101828}
table{width:100%;border-collapse:collapse;margin-top:8px}th{background:${brand};color:#fff;font-weight:700;padding:8px;text-align:right}
td{padding:8px;border-bottom:1px solid #EAECF0}tr:nth-child(even) td{background:#F8F9FC}td.name{width:40%}.b{font-weight:700}
.tot{margin-top:14px;margin-right:auto;width:46%}.tot div{display:flex;justify-content:space-between;padding:5px 0}
.grand{border-top:2px solid #101828;font-size:17px;font-weight:700;margin-top:4px;padding-top:8px!important}
.void{color:#A8352E;font-size:22px;font-weight:700;border:3px solid #A8352E;display:inline-block;padding:4px 14px;border-radius:8px;transform:rotate(-6deg)}
.foot{margin-top:28px;display:flex;justify-content:space-between;align-items:flex-end;color:#475467}
</style></head><body>
<div class="head"><div class="biz"><h1>${esc(d.businessName)}</h1>${d.address ? `<div>${esc(d.address)}</div>` : ''}${d.phones.length ? `<div dir="ltr" style="text-align:right">${d.phones.map(esc).join(' · ')}</div>` : ''}${d.vatNumber ? `<div>الرقم الضريبي: ${esc(d.vatNumber)}</div>` : ''}</div>
<div class="doc"><h2>${esc(d.title)}</h2><div>${esc(d.number)}</div><div>${esc(date)}</div></div></div>
${d.voided ? '<p class="void">ملغاة</p>' : ''}
<div class="meta">${d.customerName ? `<span>العميل: <b>${esc(d.customerName)}</b></span>` : ''}${d.cashier ? `<span>الكاشير: <b>${esc(d.cashier)}</b></span>` : ''}</div>
<table><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th>${d.template.showDiscount ? '<th>الخصم</th>' : ''}<th>الإجمالي</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot">
${d.discountMinor ? `<div><span>الخصم</span><span>-${m(d.discountMinor)}</span></div>` : ''}
${d.taxRatePct != null ? `<div><span>الإجمالي بدون الضريبة</span><span>${m(d.netMinor)}</span></div><div><span>ضريبة القيمة المضافة ${d.taxRatePct}%</span><span>${m(d.taxMinor)}</span></div>` : ''}
${d.roundingMinor ? `<div><span>تقريب</span><span>${m(d.roundingMinor)}</span></div>` : ''}
<div class="grand"><span>الإجمالي</span><span>${m(d.totalMinor)} ${cur}</span></div>
${d.payments.map((p) => `<div><span>${esc(t(`pay.methods.${p.method}`))}${p.label ? ` (${esc(p.label)})` : ''}</span><span>${m(p.amountMinor)}</span></div>`).join('')}
${d.template.showBalance && d.customerBalanceMinor ? `<div><span>رصيد العميل</span><span>${m(d.customerBalanceMinor)}</span></div>` : ''}
</div>
<div class="foot"><div>${esc(d.template.footer)}</div>${d.qr ? `<div style="width:110px">${qrSvg(d.qr)}</div>` : ''}</div>
</body></html>`;
}
