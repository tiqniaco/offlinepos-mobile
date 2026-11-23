import { useEffect, useMemo, useState } from 'react';
import { Switch, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { zatcaTimestamp, zatcaTlvBase64 } from '@daftarak/shared';
import { Screen, Text, Button, Card, TextField, Choice, ListRow, SectionTitle, colors, fonts } from '../../ui';
import { Pressable } from '../../ui/Press';
import { Segmented } from '../../features/common/Segmented';
import { getDb } from '../../db/client';
import { business } from '../../db/schema';
import { changeSetting, resolveTemplate, DEFAULT_RECEIPT, type ReceiptTemplate } from '../../domain/settings/settings';
import { requirePermission } from '../../domain/auth/users';
import { reloadAppData } from '../../state/boot';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';
import { phoneLabel } from '../../lib/format';
import { ReceiptView } from '../../features/printing/ReceiptView';
import { sampleReceiptData, type SampleShop } from '../../features/printing/sample';
import { safeColor } from '../../features/printing/a4';
import type { ReceiptData } from '../../features/printing/receiptData';
import type { PrinterConfig } from '../../features/printing/types';

type Tpl = Required<ReceiptTemplate>;
/** Calm, print-friendly brand colours (no purple — brand rule). null = the app's theme colour. */
const SWATCHES = ['#1F4FD8', '#0086C9', '#0E7C66', '#B54708', '#B42318', '#101828'];
const PAPER_DOTS = { 58: 384, 80: 576 } as const;

/** «شكل الفواتير»: thermal 58/80 + A4 classic/modern, a few switches, and a live preview of a sample. */
export default function Templates() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const settings = useApp((s) => s.settings);
  const biz = useApp((s) => s.business);
  const printer = (settings as { printer?: PrinterConfig | null }).printer ?? null;
  const [tpl, setTpl] = useState<Tpl>(() => {
    const saved = (settings as { receipt?: ReceiptTemplate }).receipt;
    const r = resolveTemplate(saved);
    // First visit: preview at the printer's own paper width.
    if (!saved?.thermalSize && printer) r.thermalSize = printer.paperWidth;
    return r;
  });
  const [kind, setKind] = useState<'INVOICE' | 'QUOTATION'>('INVOICE');
  const [fmt, setFmt] = useState<'58' | '80' | 'A4'>(() => String(tpl.thermalSize) as '58' | '80');
  const [days, setDays] = useState(String(tpl.quoteValidDays));
  const [shop, setShop] = useState<SampleShop>({ name: biz?.name ?? '', address: null, phones: [], vatNumber: null, logoPath: null, currency: biz?.currency ?? 'EGP' });
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);
  const set = <K extends keyof Tpl>(k: K, v: Tpl[K]) => setTpl((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    void getDb()
      .select()
      .from(business)
      .limit(1)
      .then(([b]) => {
        if (b) setShop({ name: b.name, address: b.address, phones: (JSON.parse(b.phonesJson) as string[]).map((p) => phoneLabel(p)).filter(Boolean), vatNumber: b.vatNumber, logoPath: b.logoPath, currency: b.currency });
      }, () => undefined);
  }, []);

  const s = settings as { vatRegistered?: boolean; vatRateBp?: number; zatcaQr?: boolean };
  const qrAvailable = !!s.zatcaQr;
  const sample: ReceiptData = useMemo(() => {
    const d = sampleReceiptData(kind, tpl, shop, { vatRatePct: s.vatRegistered && s.vatRateBp ? s.vatRateBp / 100 : null, cashier: user.name });
    if (qrAvailable && kind === 'INVOICE') d.qr = zatcaTlvBase64({ sellerName: d.businessName, vatNumber: d.vatNumber ?? '300000000000003', timestamp: zatcaTimestamp(d.date), totalWithVatMinor: d.totalMinor, vatMinor: d.taxMinor });
    return d;
  }, [kind, tpl, shop, s.vatRegistered, s.vatRateBp, qrAvailable, user.name]);
  const brand = safeColor(tpl.brandColor ?? colors.primary['600']);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      requirePermission(user, 'settings.manage');
      const n = Math.min(365, Math.max(1, parseInt(days, 10) || DEFAULT_RECEIPT.quoteValidDays));
      await changeSetting(getDb(), 'receipt', { ...tpl, quoteValidDays: n }, { userId: user.id, deviceId: device.id, permissions: user.permissions });
      await reloadAppData();
      toast(t('productForm.saved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openA4 = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const { receiptHtml } = await import('../../features/printing/pdf');
      const { previewHtml } = await import('../../features/printing/actions');
      await previewHtml(await receiptHtml({ ...sample, template: { ...tpl, brandColor: brand } }));
    } finally {
      setOpening(false);
    }
  };

  const toggles: [keyof Tpl, string][] = [
    ['showLogo', t('printers.showLogo')],
    ['showCashier', t('templates.showCashier')],
    ['showBalance', t('printers.showBalance')],
    ['showItemCode', t('templates.showItemCode')],
    ['showDiscount', t('printers.showDiscount')],
    ['showTax', t('printers.showTax')],
    ['showWords', t('templates.showWords')],
    ...(qrAvailable ? ([['showQr', t('templates.showQr')]] as [keyof Tpl, string][]) : []),
  ];

  return (
    <Screen back title={t('templates.title')} footer={<Button title={t('common.save')} loading={saving} onPress={save} />}>
      {/* ── Live preview ─────────────────────────────────────────── */}
      <Segmented value={kind} onChange={setKind} options={[{ value: 'INVOICE', label: t('templates.invoice') }, { value: 'QUOTATION', label: t('templates.quote') }]} />
      <Segmented value={fmt} onChange={setFmt} options={[{ value: '58', label: t('templates.fmt58') }, { value: '80', label: t('templates.fmt80') }, { value: 'A4', label: 'A4' }]} />
      <View style={{ backgroundColor: colors.paper.sunk, borderRadius: 16, padding: 12, alignItems: 'center', gap: 10 }}>
        {fmt === 'A4' ? (
          <>
            <A4Mini d={sample} tpl={tpl} brand={brand} />
            <Button kind="secondary" compact icon="file" title={t('templates.fullPreview')} loading={opening} onPress={() => void openA4()} />
          </>
        ) : (
          <ThermalPreview d={sample} dots={PAPER_DOTS[fmt === '58' ? 58 : 80]} />
        )}
        <Text variant="caption" style={{ textAlign: 'center' }}>
          {t('templates.previewHint')}
        </Text>
      </View>

      {/* ── Format & style ───────────────────────────────────────── */}
      <SectionTitle>{t('templates.thermalSize')}</SectionTitle>
      <Segmented
        value={String(tpl.thermalSize) as '58' | '80'}
        onChange={(v) => {
          set('thermalSize', v === '58' ? 58 : 80);
          if (fmt !== 'A4') setFmt(v);
        }}
        options={[{ value: '58', label: t('printers.mm58') }, { value: '80', label: t('printers.mm80') }]}
      />
      {printer && printer.paperWidth !== tpl.thermalSize ? <Text variant="caption">{t('templates.thermalNote', { mm: printer.paperWidth })}</Text> : null}

      <SectionTitle>{t('templates.a4Style')}</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Choice compact title={t('templates.modern')} hint={t('templates.modernHint')} selected={tpl.a4Style === 'modern'} onPress={() => { set('a4Style', 'modern'); setFmt('A4'); }} />
        <Choice compact title={t('templates.classic')} hint={t('templates.classicHint')} selected={tpl.a4Style === 'classic'} onPress={() => { set('a4Style', 'classic'); setFmt('A4'); }} />
      </View>

      <SectionTitle>{t('templates.brand')}</SectionTitle>
      <Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
          <Swatch color={colors.primary['600']} label={t('templates.themeColor')} selected={tpl.brandColor == null} onPress={() => { set('brandColor', null); setFmt('A4'); }} />
          {SWATCHES.map((c) => (
            <Swatch key={c} color={c} selected={tpl.brandColor === c} onPress={() => { set('brandColor', c); setFmt('A4'); }} />
          ))}
        </View>
      </Card>

      {/* ── What shows ───────────────────────────────────────────── */}
      <SectionTitle>{t('templates.show')}</SectionTitle>
      <Card>
        <View style={{ gap: 12 }}>
          {toggles.map(([k, label]) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Text variant="subtitle" style={{ flex: 1 }}>
                {label}
              </Text>
              <Switch value={!!tpl[k]} onValueChange={(v) => set(k, v as never)} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
            </View>
          ))}
        </View>
      </Card>

      {/* ── Texts ────────────────────────────────────────────────── */}
      <SectionTitle>{t('templates.texts')}</SectionTitle>
      <TextField label={t('templates.headerNote')} hint={t('templates.headerNoteHint')} value={tpl.headerNote} onChangeText={(v) => set('headerNote', v)} latinDigits={false} maxLength={80} />
      <TextField label={t('printers.footer')} value={tpl.footer} onChangeText={(v) => set('footer', v)} latinDigits={false} maxLength={120} />
      <TextField label={t('templates.quoteTerms')} value={tpl.quoteTerms} onChangeText={(v) => { set('quoteTerms', v); setKind('QUOTATION'); }} latinDigits={false} multiline style={{ height: 80 }} maxLength={400} />
      <TextField label={t('templates.quoteDays')} value={days} onChangeText={(v) => { setDays(v.replace(/\D/g, '')); const n = parseInt(v, 10); if (n > 0 && n <= 365) set('quoteValidDays', n); setKind('QUOTATION'); }} keyboardType="number-pad" ltr maxLength={3} />

      <Card padded={false}>
        <ListRow icon="store" hue="amber" title={t('templates.shopDetails')} subtitle={t('templates.shopDetailsHint')} onPress={() => router.push('/settings/receipt')} />
        <ListRow icon="refresh" hue="ink" title={t('templates.reset')} last onPress={() => { setTpl({ ...DEFAULT_RECEIPT, thermalSize: tpl.thermalSize }); setDays(String(DEFAULT_RECEIPT.quoteValidDays)); }} />
      </Card>
    </Screen>
  );
}

function Swatch({ color, label, selected, onPress }: { color: string; label?: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={label ?? color} onPress={onPress} style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: color, borderWidth: 3, borderColor: selected ? colors.ink.DEFAULT : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {selected ? <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 16, lineHeight: 22 }}>✓</Text> : null}
      </View>
      {label ? <Text variant="caption" style={{ fontSize: 11, lineHeight: 15 }}>{label}</Text> : null}
    </Pressable>
  );
}

/** The real thermal receipt (same component that is rasterised for the printer), scaled to the screen. */
function ThermalPreview({ d, dots }: { d: ReceiptData; dots: number }) {
  const { width } = useWindowDimensions();
  const [h, setH] = useState(0);
  const target = Math.min(width - 56, dots === 384 ? 260 : 330);
  const k = target / dots;
  return (
    <View style={{ width: dots * k, height: h ? h * k : 300, overflow: 'hidden', borderRadius: 6, backgroundColor: '#FFFFFF' }}>
      <View
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={{ position: 'absolute', left: 0, top: 0, width: dots, transform: [{ translateX: -(dots * (1 - k)) / 2 }, { translateY: -((h || 300 / k) * (1 - k)) / 2 }, { scale: k }] }}
      >
        <ReceiptView d={d} dots={dots} />
      </View>
    </View>
  );
}

/** A small native sketch of the A4 page (style, colour, sections); «معاينة كاملة» opens the real PDF. */
function A4Mini({ d, tpl, brand }: { d: ReceiptData; tpl: Tpl; brand: string }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width - 56, 320);
  const classic = tpl.a4Style === 'classic';
  const line = classic ? '#101828' : '#EAECF0';
  const tx = (size: number, b = false, color = '#101828') => ({ fontSize: size, lineHeight: Math.round(size * 1.6), fontFamily: b ? fonts.bold : fonts.medium, color });
  const fm = (v: number) => (v / 100).toFixed(2);
  const quote = d.kind === 'QUOTATION';
  return (
    <View style={{ width: w, aspectRatio: 1 / 1.414, backgroundColor: '#FFFFFF', borderRadius: 4, padding: 10, gap: 6, overflow: 'hidden' }}>
      {!classic ? <View style={{ height: 3, backgroundColor: brand, borderRadius: 2, marginBottom: 2 }} /> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: classic ? 2 : 0, borderColor: '#101828', paddingBottom: classic ? 4 : 0 }}>
        <View style={{ flex: 1 }}>
          <Text allowFontScaling={false} numberOfLines={1} style={tx(11, true)}>
            {d.businessName}
          </Text>
          {d.address ? <Text allowFontScaling={false} numberOfLines={1} style={tx(6.5, false, '#475467')}>{d.address}</Text> : null}
        </View>
        <View style={{ borderWidth: classic ? 1 : 0, borderColor: '#101828', paddingHorizontal: 6, alignItems: 'center' }}>
          <Text allowFontScaling={false} style={tx(10, true, classic ? '#101828' : brand)}>{d.title}</Text>
          <Text allowFontScaling={false} style={tx(6, false, '#475467')}>{d.number}</Text>
        </View>
      </View>
      {tpl.headerNote ? <Text allowFontScaling={false} numberOfLines={1} style={[tx(6.5, true, classic ? '#101828' : brand), { textAlign: 'center' }]}>{tpl.headerNote}</Text> : null}
      <View style={{ backgroundColor: classic ? '#FFFFFF' : '#F8F9FC', borderWidth: classic ? 1 : 0, borderColor: line, borderRadius: classic ? 0 : 5, padding: 4 }}>
        <Text allowFontScaling={false} style={tx(6.5, true)}>{`${quote ? 'مقدَّم إلى' : 'العميل'}: ${d.customerName}`}</Text>
      </View>
      <View style={{ borderWidth: classic ? 1 : 0, borderColor: line }}>
        <View style={{ flexDirection: 'row', backgroundColor: classic ? '#F2F4F7' : `${brand}24`, borderBottomWidth: classic ? 0 : 1.5, borderColor: brand, paddingHorizontal: 4 }}>
          <Text allowFontScaling={false} style={[tx(6.5, true), { flex: 1 }]}>الصنف</Text>
          <Text allowFontScaling={false} style={[tx(6.5, true), { width: 34, textAlign: 'center' }]}>الكمية</Text>
          <Text allowFontScaling={false} style={[tx(6.5, true), { width: 48, textAlign: 'left' }]}>الإجمالي</Text>
        </View>
        {d.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', paddingHorizontal: 4, borderTopWidth: 1, borderColor: line, backgroundColor: !classic && i % 2 ? '#F8F9FC' : '#FFFFFF' }}>
            <Text allowFontScaling={false} numberOfLines={1} style={[tx(6.5), { flex: 1 }]}>{l.name}</Text>
            <Text allowFontScaling={false} style={[tx(6.5), { width: 34, textAlign: 'center' }]}>{l.qtyMilli / 1000}</Text>
            <Text allowFontScaling={false} style={[tx(6.5), { width: 48, textAlign: 'left' }]}>{fm(l.totalMinor)}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}>
          {tpl.showWords ? <View style={{ backgroundColor: classic ? '#FFFFFF' : `${brand}14`, borderWidth: classic ? 1 : 0, borderColor: line, borderRadius: classic ? 0 : 4, padding: 3 }}><Text allowFontScaling={false} numberOfLines={2} style={tx(5.5, true)}>المبلغ بالحروف…</Text></View> : null}
          {quote && tpl.quoteTerms ? <Text allowFontScaling={false} numberOfLines={2} style={tx(5.5, false, '#475467')}>{tpl.quoteTerms}</Text> : null}
        </View>
        <View style={{ width: '44%', borderWidth: classic ? 1 : 0, borderColor: line, borderRadius: classic ? 0 : 5, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: classic ? '#F2F4F7' : brand, paddingHorizontal: 4 }}>
            <Text allowFontScaling={false} style={tx(7.5, true, classic ? '#101828' : '#FFFFFF')}>الإجمالي</Text>
            <Text allowFontScaling={false} style={tx(7.5, true, classic ? '#101828' : '#FFFFFF')}>{fm(d.totalMinor)}</Text>
          </View>
        </View>
      </View>
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 8 }}>
        <View style={{ flex: 1, borderTopWidth: 1, borderColor: '#98A2B3', borderStyle: classic ? 'solid' : 'dashed' }} />
        <View style={{ flex: 1, borderTopWidth: 1, borderColor: '#98A2B3', borderStyle: classic ? 'solid' : 'dashed' }} />
      </View>
      {tpl.footer ? <Text allowFontScaling={false} numberOfLines={1} style={[tx(6, false, '#475467'), { textAlign: 'center' }]}>{tpl.footer}</Text> : null}
    </View>
  );
}
