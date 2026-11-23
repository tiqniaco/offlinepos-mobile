import { useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, Card, Chip, ListGroup, ListRow, SectionTitle, Banner, Icon, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { changeSetting } from '../../domain/settings/settings';
import { reloadAppData } from '../../state/boot';
import { useApp } from '../../state/app';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';
import { defaultDots, driverFor, platformDrivers } from '../../features/printing/printerConfig';
import { renderReceiptBytes } from '../../features/printing/PrintHost';
import { sendToPrinter } from '../../features/printing/actions';
import { PrintError, type FoundPrinter, type PrinterConfig } from '../../features/printing/types';
import type { ReceiptData } from '../../features/printing/receiptData';
import { DEFAULT_RECEIPT } from '../../domain/settings/settings';

/** Printer setup (SPEC §3): scan → pick → test print → save as default. */
export default function Printers() {
  const { t } = useTranslation();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const business = useApp((s) => s.business);
  const saved = (useApp((s) => s.settings) as { printer?: PrinterConfig | null }).printer ?? null;
  const [found, setFound] = useState<FoundPrinter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [cfg, setCfg] = useState<PrinterConfig | null>(saved);
  const [busy, setBusy] = useState(false);

  const scan = async () => {
    setFound([]);
    setScanning(true);
    try {
      await Promise.all(platformDrivers().map((d) => d.scan((p) => setFound((f) => (f.some((x) => x.address === p.address) ? f : [...f, p])))));
    } catch (e) {
      toast(t(`printers.errors.${e instanceof PrintError ? e.code : 'connect'}`), 'error');
    } finally {
      setScanning(false);
    }
  };

  const save = async (c: PrinterConfig | null) => {
    try {
      await changeSetting(getDb(), 'printer', c, { userId: user.id, deviceId: device.id });
      await reloadAppData();
      setCfg(c);
      toast(t('printers.saved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };

  const test = async () => {
    if (!cfg) return;
    setBusy(true);
    const sample: ReceiptData = {
      kind: 'INVOICE',
      title: 'تجربة طباعة',
      number: 'TEST',
      date: Date.now(),
      businessName: business?.name ?? 'كاشيرو',
      address: null,
      phones: [],
      vatNumber: null,
      logoPath: null,
      cashier: user.name,
      customerName: null,
      customerBalanceMinor: null,
      lines: [
        { name: 'شاي العروسة 250 جم', qtyMilli: 2000, unit: 'قطعة', priceMinor: 2200, discountMinor: 0, totalMinor: 4400 },
        { name: 'زيت عافية — عربي واضح ✓', qtyMilli: 1000, unit: 'زجاجة', priceMinor: 7450, discountMinor: 0, totalMinor: 7450 },
      ],
      discountMinor: 0,
      netMinor: 11_850,
      taxMinor: 0,
      taxRatePct: null,
      roundingMinor: 0,
      totalMinor: 11_850,
      creditMinor: 0,
      changeMinor: 0,
      tenderedMinor: 0,
      payments: [{ method: 'cash', label: null, amountMinor: 11_850 }],
      voided: false,
      qr: 'https://daftarak.app',
      currency: business?.currency ?? 'EGP',
      template: DEFAULT_RECEIPT,
    };
    try {
      await sendToPrinter({ ...cfg, copies: 1 }, await renderReceiptBytes(sample, cfg.dots, cfg.openDrawer));
      toast(t('printers.testOk'));
    } catch (e) {
      toast(t(`printers.errors.${e instanceof PrintError ? e.code : 'write'}`), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pick = (p: FoundPrinter) => setCfg({ driver: p.driver, address: p.address, name: p.name, paperWidth: cfg?.paperWidth ?? 58, dots: defaultDots(cfg?.paperWidth ?? 58), autoPrint: cfg?.autoPrint ?? true, openDrawer: cfg?.openDrawer ?? false, copies: cfg?.copies ?? 1 });

  return (
    <Screen back title={t('printers.title')}>
      {Platform.OS === 'ios' ? <Banner tone="info" text={t('printers.iosNote')} /> : null}
      <SectionTitle>{t('printers.current')}</SectionTitle>
      {cfg ? (
        <Card>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="clipboard" color={colors.primary[600]} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{cfg.name}</Text>
                <Text variant="caption">{cfg.driver === 'spp' ? t('printers.classic') : t('printers.ble')}</Text>
              </View>
            </View>
            <Text variant="label">{t('printers.paper')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label={t('printers.mm58')} selected={cfg.paperWidth === 58} onPress={() => setCfg({ ...cfg, paperWidth: 58, dots: defaultDots(58) })} />
              <Chip label={t('printers.mm80')} selected={cfg.paperWidth === 80} onPress={() => setCfg({ ...cfg, paperWidth: 80, dots: defaultDots(80) })} />
              {cfg.paperWidth === 80 ? <Chip label="72 mm (512)" selected={cfg.dots === 512} onPress={() => setCfg({ ...cfg, dots: cfg.dots === 512 ? 576 : 512 })} /> : null}
            </View>
            {[
              ['autoPrint', t('printers.autoPrint')],
              ['openDrawer', t('printers.drawer')],
            ].map(([k, label]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="subtitle" style={{ flex: 1 }}>
                  {label}
                </Text>
                <Switch value={!!cfg[k as 'autoPrint']} onValueChange={(v) => setCfg({ ...cfg, [k as string]: v })} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="subtitle" style={{ flex: 1 }}>
                {t('printers.copies')}
              </Text>
              {[1, 2].map((n) => (
                <Chip key={n} label={String(n)} selected={cfg.copies === n} onPress={() => setCfg({ ...cfg, copies: n })} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button compact kind="secondary" title={t('printers.test')} loading={busy} onPress={test} />
              </View>
              <View style={{ flex: 1 }}>
                <Button compact title={t('printers.save')} onPress={() => void save(cfg)} />
              </View>
            </View>
            {saved ? <Button compact kind="ghost" title={t('printers.remove')} onPress={() => { void driverFor(saved).disconnect(); void save(null); }} /> : null}
          </View>
        </Card>
      ) : (
        <Text variant="caption">{t('printers.none')}</Text>
      )}
      <Button icon="search" title={scanning ? t('printers.scanning') : t('printers.scan')} loading={scanning} onPress={scan} />
      {found.length ? (
        <ListGroup>
          {found.map((p, i) => (
            <ListRow key={p.address} icon="clipboard" hue={p.paired ? 'primary' : 'ink'} title={p.name} subtitle={`${p.driver === 'spp' ? t('printers.classic') : t('printers.ble')}${p.paired ? ` · ${t('printers.paired')}` : ''}`} onPress={() => pick(p)} last={i === found.length - 1} />
          ))}
        </ListGroup>
      ) : null}
      <ListGroup>
        <ListRow icon="edit" hue="amber" title={t('printers.receipt')} onPress={() => router.push('/settings/receipt')} last />
      </ListGroup>
    </Screen>
  );
}
