/**
 * Thermal version of a ReportDoc, drawn in printer dots like ReceiptView (black on white, Arabic shaped by
 * the phone, then rasterised). 58 mm hides `wideOnly` columns.
 */
import { Text as RNText, View } from 'react-native';
import { fonts } from '../../ui';
import type { ReportDoc } from './report';

const INK = '#000000';

function T({ s = 22, b = false, center = false, children, style }: { s?: number; b?: boolean; center?: boolean; children: React.ReactNode; style?: object }) {
  return <RNText style={[{ color: INK, fontSize: s, lineHeight: Math.round(s * 1.45), fontFamily: b ? fonts.bold : fonts.medium, textAlign: center ? 'center' : 'auto' }, style]}>{children}</RNText>;
}
const Rule = () => <View style={{ borderTopWidth: 2, borderStyle: 'dashed', borderColor: INK, marginVertical: 8 }} />;
function KV({ label, value, b = false, s = 22 }: { label: string; value: string; b?: boolean; s?: number }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <T s={s} b={b}>{label}</T>
      <T s={s} b={b} style={{ writingDirection: 'ltr' }}>{value}</T>
    </View>
  );
}

export function ReportView({ d, dots }: { d: ReportDoc; dots: number }) {
  const wide = dots >= 512;
  const cols = d.columns.filter((c) => wide || !c.wideOnly);
  const date = d.date ? new Date(d.date) : null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={{ width: dots, backgroundColor: '#FFFFFF', paddingHorizontal: 8, paddingVertical: 12 }}>
      <T s={wide ? 34 : 30} b center>{d.businessName}</T>
      {d.phones?.length ? <T s={20} center style={{ writingDirection: 'ltr' }}>{d.phones.join(' - ')}</T> : null}
      <Rule />
      <T s={26} b center>{d.title}</T>
      {d.number ? <T s={20} center style={{ writingDirection: 'ltr' }}>{d.number}</T> : null}
      {date ? <T s={20} center style={{ writingDirection: 'ltr' }}>{`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`}</T> : null}
      {d.voided ? <T s={30} b center>*** ملغي ***</T> : null}
      {d.partyLine ? <T s={22} b>{d.partyLine}</T> : null}
      {d.period ? <T s={20}>{d.period}</T> : null}
      {d.summary.length ? <Rule /> : null}
      {d.summary.map((s) => <KV key={s.label} label={s.label} value={s.value} b={s.strong} />)}
      {d.rows.length ? (
        <>
          <Rule />
          {d.rows.map((r, i) => (
            <View key={i} style={{ paddingVertical: 4, borderBottomWidth: 1, borderColor: '#000', borderStyle: 'dotted', opacity: r.muted ? 0.5 : 1 }}>
              {cols.filter((c) => !c.num && r.cells[c.key]).map((c, j) => (
                <T key={c.key} s={j === 0 && cols.filter((x) => !x.num).length > 1 ? 18 : 21} b={j > 0 || cols.filter((x) => !x.num).length === 1}>{r.cells[c.key]}</T>
              ))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 10 }}>
                {cols.filter((c) => c.num && r.cells[c.key]).map((c) => (
                  <T key={c.key} s={19}>{`${c.label}: `}<T s={19} b style={{ writingDirection: 'ltr' }}>{r.cells[c.key]}</T></T>
                ))}
              </View>
              {r.sub?.map((s, j) => <T key={j} s={18}>{`  • ${s}`}</T>)}
            </View>
          ))}
        </>
      ) : null}
      {d.totals.length ? <Rule /> : null}
      {d.totals.map((s) => <KV key={s.label} label={s.label} value={s.value} b={s.strong} s={s.strong ? 26 : 22} />)}
      {d.note ? <T s={20}>{d.note}</T> : null}
      <Rule />
      <T s={18} center>{d.footer ?? 'كاشيرو'}</T>
      <View style={{ height: 24 }} />
    </View>
  );
}
