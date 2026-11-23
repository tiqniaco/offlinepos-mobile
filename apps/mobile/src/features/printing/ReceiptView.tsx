/**
 * The thermal receipt, drawn in PRINTER DOTS (width = 384 for 58 mm, 576 for 80 mm). It is rendered
 * off-screen, captured as an image and sent as ESC/POS raster — so Arabic shaping is always right.
 * Pure black on white, no theme colours.
 */
import { Image, Text as RNText, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import i18n from 'i18next';
import { formatMinor, formatQty, lineAmount } from '@daftarak/shared';
import { fonts } from '../../ui';
import type { ReceiptData } from './receiptData';
import { qrSvg } from './qr';

const INK = '#000000';

function T({ s = 22, b = false, center = false, children, style }: { s?: number; b?: boolean; center?: boolean; children: React.ReactNode; style?: object }) {
  // Arabic glyphs (diacritics, tall alef) clip below ~1.7; the receipt is drawn in dots, so never font-scale it.
  return <RNText allowFontScaling={false} style={[{ color: INK, fontSize: s, lineHeight: Math.round(s * 1.7), fontFamily: b ? fonts.bold : fonts.medium, textAlign: center ? 'center' : 'auto' }, style]}>{children}</RNText>;
}

const Rule = ({ dashed = true }: { dashed?: boolean }) => <View style={{ borderTopWidth: 2, borderStyle: dashed ? 'dashed' : 'solid', borderColor: INK, marginVertical: 8 }} />;

function Row({ label, value, s = 22, b = false }: { label: string; value: string; s?: number; b?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <T s={s} b={b} style={{ flex: 1 }}>
        {label}
      </T>
      <T s={s} b={b} style={{ writingDirection: 'ltr', flexShrink: 0 }}>
        {value}
      </T>
    </View>
  );
}

export function ReceiptView({ d, dots }: { d: ReceiptData; dots: number }) {
  const t = i18n.t.bind(i18n);
  const wide = dots >= 512;
  const tpl = d.template;
  const quote = d.kind === 'QUOTATION';
  const m = (v: number) => formatMinor(v);
  const cur = d.currency === 'SAR' ? 'ر.س' : 'ج.م';
  // Digits only (no Arabic AM/PM) so the line never gets reordered by bidi rules.
  const dt = new Date(d.date);
  const p2 = (n: number) => String(n).padStart(2, '0');
  const date = `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}  ${p2(dt.getHours())}:${p2(dt.getMinutes())}`;
  const day = (ms: number) => {
    const x = new Date(ms);
    return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`;
  };
  const gross = d.lines.reduce((a, l) => a + lineAmount(l.priceMinor, l.qtyMilli), 0);
  const vat = tpl.showTax && d.taxRatePct != null;
  const sm = wide ? 22 : 20;
  return (
    <View collapsable={false} style={{ width: dots, backgroundColor: '#FFFFFF', paddingHorizontal: 6, paddingVertical: 14 }}>
      {tpl.showLogo && d.logoPath ? <Image source={{ uri: d.logoPath }} style={{ width: dots * 0.32, height: dots * 0.32, alignSelf: 'center', marginBottom: 6 }} resizeMode="contain" /> : null}
      <T s={wide ? 38 : 32} b center>
        {d.businessName}
      </T>
      {d.address ? (
        <T s={sm} center>
          {d.address}
        </T>
      ) : null}
      {d.phones.length ? (
        <T s={sm} center style={{ writingDirection: 'ltr' }}>
          {d.phones.map((p) => (p.startsWith('20') ? `0${p.slice(2)}` : p.startsWith('966') ? `0${p.slice(3)}` : p)).join(' - ')}
        </T>
      ) : null}
      {d.vatNumber ? (
        <T s={sm} center>
          الرقم الضريبي: {d.vatNumber}
        </T>
      ) : null}
      {tpl.headerNote ? (
        <T s={sm} b center style={{ marginTop: 4 }}>
          {tpl.headerNote}
        </T>
      ) : null}
      {/* Title on a solid black band: the first thing the eye finds on the paper. */}
      <View style={{ backgroundColor: INK, borderRadius: 6, marginTop: 10, marginBottom: 6, paddingVertical: 2 }}>
        <T s={wide ? 30 : 26} b center style={{ color: '#FFFFFF' }}>
          {d.voided ? `${d.title} — ملغاة` : d.title}
        </T>
      </View>
      <Row s={sm} label={quote ? 'رقم العرض' : 'رقم الفاتورة'} value={d.number || '—'} />
      <Row s={sm} label="التاريخ" value={date} />
      {quote && d.validUntil ? <Row s={sm} b label="صالح حتى" value={day(d.validUntil)} /> : null}
      {tpl.showCashier && d.cashier ? <Row s={sm} label="الكاشير" value={d.cashier} /> : null}
      {d.customerName ? <Row s={sm} label="العميل" value={d.customerName} /> : null}
      {d.customerName && d.customerPhone ? <Row s={sm} label="الموبايل" value={d.customerPhone} /> : null}
      <Rule dashed={false} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T s={sm} b>
          الصنف / الكمية × السعر
        </T>
        <T s={sm} b>
          الإجمالي
        </T>
      </View>
      <Rule />
      {d.lines.map((l, i) => (
        <View key={i} style={{ marginBottom: 6 }}>
          <T s={wide ? 24 : 22} b>
            {l.name}
          </T>
          {tpl.showItemCode && l.code ? (
            <T s={16} style={{ writingDirection: 'ltr', textAlign: 'right' }}>
              {l.code}
            </T>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T s={sm}>{`${formatQty(l.qtyMilli)} ${l.unit} × ${m(l.priceMinor)}`}</T>
            <T s={wide ? 24 : 22} b style={{ writingDirection: 'ltr' }}>
              {m(l.totalMinor)}
            </T>
          </View>
          {tpl.showDiscount && l.discountMinor > 0 ? <T s={18}>{`خصم ${m(l.discountMinor)}`}</T> : null}
        </View>
      ))}
      <Rule />
      <T s={sm}>{`عدد الأصناف: ${d.lines.length}`}</T>
      {tpl.showDiscount && d.discountMinor > 0 ? (
        <>
          <Row label="الإجمالي قبل الخصم" value={m(gross)} />
          <Row label="الخصم" value={`-${m(d.discountMinor)}`} />
        </>
      ) : null}
      {vat ? (
        <>
          <Row label="الإجمالي بدون الضريبة" value={m(d.netMinor)} />
          <Row label={`ضريبة القيمة المضافة ${d.taxRatePct}%`} value={m(d.taxMinor)} />
        </>
      ) : null}
      {d.roundingMinor ? <Row label="تقريب" value={m(d.roundingMinor)} /> : null}
      <View style={{ borderWidth: 3, borderColor: INK, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginVertical: 6 }}>
        <Row s={wide ? 36 : 30} b label={quote ? 'إجمالي العرض' : 'الإجمالي'} value={`${m(d.totalMinor)} ${cur}`} />
      </View>
      {!quote
        ? d.payments.map((p, i) => <Row key={i} s={sm} label={`${t(`pay.methods.${p.method}`)}${p.label ? ` (${p.label})` : ''}`} value={m(p.amountMinor)} />)
        : null}
      {!quote && d.tenderedMinor > 0 && d.changeMinor > 0 ? (
        <>
          <Row s={sm} label="المدفوع نقداً" value={m(d.tenderedMinor)} />
          <Row s={wide ? 26 : 24} b label="الباقي" value={m(d.changeMinor)} />
        </>
      ) : null}
      {!quote && d.creditMinor ? <Row s={sm} b label="المتبقي (آجل)" value={m(d.creditMinor)} /> : null}
      {!quote && tpl.showBalance && d.customerBalanceMinor != null && d.customerBalanceMinor !== 0 ? <Row s={sm} label="رصيد العميل" value={m(d.customerBalanceMinor)} /> : null}
      {quote && tpl.quoteTerms ? (
        <>
          <Rule />
          <T s={18}>{tpl.quoteTerms}</T>
        </>
      ) : null}
      {tpl.showQr && d.qr ? (
        <View style={{ alignItems: 'center', marginTop: 10 }}>
          <SvgXml xml={qrSvg(d.qr)} width={wide ? 240 : 200} height={wide ? 240 : 200} />
        </View>
      ) : null}
      <Rule />
      {tpl.footer ? (
        <T s={wide ? 24 : 22} center>
          {tpl.footer}
        </T>
      ) : null}
      <T s={16} center>
        كاشيرو
      </T>
    </View>
  );
}
