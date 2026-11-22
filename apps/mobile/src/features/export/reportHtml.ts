/** ReportDoc → A4 HTML (expo-print → PDF). Same look as the invoice PDF (TIQNIA-blue header row). */
import { colors } from '../../ui';
import { embeddedFontCss, esc } from '../printing/pdf';
import type { ReportDoc } from './report';

export async function reportHtml(d: ReportDoc): Promise<string> {
  const brand = colors.primary['600'];
  const date = d.date ? new Date(d.date).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const head = d.columns.map((c) => `<th class="${c.num ? 'n' : ''}">${esc(c.label)}</th>`).join('');
  const body = d.rows
    .map((r) => {
      const main = `<tr class="${r.muted ? 'muted' : ''}">${d.columns.map((c) => `<td class="${c.num ? 'n' : ''}">${esc(r.cells[c.key] ?? '')}</td>`).join('')}</tr>`;
      const sub = r.sub?.length ? `<tr class="sub"><td colspan="${d.columns.length}">${r.sub.map(esc).join('<br/>')}</td></tr>` : '';
      return main + sub;
    })
    .join('');
  const kv = (xs: { label: string; value: string; strong?: boolean }[]) => xs.map((x) => `<div class="${x.strong ? 'strong' : ''}"><span>${esc(x.label)}</span><span dir="ltr">${esc(x.value)}</span></div>`).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/>
<style>${await embeddedFontCss()}
@page{size:A4;margin:14mm 12mm}
*{box-sizing:border-box}body{font-family:'Readex',sans-serif;color:#101828;font-size:11.5px;margin:0}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${brand};padding-bottom:10px}
.biz h1{margin:0;font-size:20px;color:${brand}}.biz div{color:#475467;margin-top:2px}
.doc{text-align:left}.doc h2{margin:0;font-size:17px}.doc div{color:#475467;margin-top:2px}
.party{margin:10px 0 4px;font-size:13px}.period{color:#475467}
.sum{display:flex;gap:8px;margin:10px 0}.sum div{flex:1;background:#EEF3FF;border-radius:8px;padding:8px 10px}
.sum span{display:block;color:#475467;font-size:10.5px}.sum b{font-size:15px}
table{width:100%;border-collapse:collapse;margin-top:6px}th{background:${brand};color:#fff;font-weight:700;padding:6px;text-align:right;font-size:11px}
td{padding:6px;border-bottom:1px solid #EAECF0;vertical-align:top}tr:nth-child(4n+1) td,tr:nth-child(4n+2) td{background:#FAFBFD}
.n{text-align:left;direction:ltr;white-space:nowrap}tr.sub td{color:#475467;font-size:10.5px;padding-top:0;background:transparent!important}
tr.muted td{color:#98A2B3;text-decoration:line-through}
.tot{margin-top:12px;margin-right:auto;width:50%}.tot div{display:flex;justify-content:space-between;padding:4px 0}
.tot .strong{border-top:2px solid #101828;font-size:15px;font-weight:700;margin-top:4px;padding-top:6px}
.void{color:#A8352E;font-size:20px;font-weight:700;border:3px solid #A8352E;display:inline-block;padding:3px 12px;border-radius:8px;transform:rotate(-6deg)}
.note{margin-top:10px;color:#475467}.foot{margin-top:22px;color:#98A2B3;font-size:10px;text-align:center}
</style></head><body>
<div class="head"><div class="biz"><h1>${esc(d.businessName)}</h1>${d.address ? `<div>${esc(d.address)}</div>` : ''}${d.phones?.length ? `<div dir="ltr" style="text-align:right">${d.phones.map(esc).join(' · ')}</div>` : ''}${d.vatNumber ? `<div>الرقم الضريبي: ${esc(d.vatNumber)}</div>` : ''}</div>
<div class="doc"><h2>${esc(d.title)}</h2>${d.number ? `<div dir="ltr">${esc(d.number)}</div>` : ''}${date ? `<div>${esc(date)}</div>` : ''}</div></div>
${d.voided ? '<p class="void">ملغي</p>' : ''}
${d.partyLine ? `<div class="party"><b>${esc(d.partyLine)}</b></div>` : ''}${d.period ? `<div class="period">${esc(d.period)}</div>` : ''}
${d.summary.length ? `<div class="sum">${d.summary.map((s) => `<div><span>${esc(s.label)}</span><b dir="ltr">${esc(s.value)}</b></div>`).join('')}</div>` : ''}
${d.rows.length ? `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` : ''}
${d.totals.length ? `<div class="tot">${kv(d.totals)}</div>` : ''}
${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
<div class="foot">${esc(d.footer ?? 'دفترك')}</div>
</body></html>`;
}
