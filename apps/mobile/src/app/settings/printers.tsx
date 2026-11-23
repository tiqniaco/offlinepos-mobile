import { useState } from 'react';
import { Alert, Platform, Switch, View } from 'react-native';
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
  /** A scan finished (to tell "nothing found" apart from "not searched yet"). */
  const [searched, setSearched] = useState(false);

  const scan = async () => {
    setFound([]);
    setSearched(false);
    setScanning(true);
    try {
      await Promise.all(platformDrivers().map((d) => d.scan((p) => setFound((f) => (f.some((x) => x.address === p.address) ? f : [...f, p])))));
    } catch (e) {
      toast(t(`printers.errors.${e instanceof PrintError ? e.code : 'connect'}`), 'error');
    } finally {
      setScanning(false);
      setSearched(true);
    }
  };

  const save = async (c: PrinterConfig | null, quiet = false) => {
    setCfg(c);
    try {
      await changeSetting(getDb(), 'printer', c, { userId: user.id, deviceId: device.id });
      await reloadAppData();
      if (!quiet) toast(c ? t('printers.saved') : t('printers.removed'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  /** Every option change is saved right away (no separate save step to forget). */
  const update = (c: PrinterConfig) => void save(c, true);
  const remove = () =>
    Alert.alert(t('printers.removeTitle'), t('printers.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('printers.remove'),
        style: 'destructive',
        onPress: () => {
          if (saved) void driverFor(saved).disconnect();
          void save(null);
        },
      },
    ]);

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
      qr: null,
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

  // Picking a printer saves it as this phone's printer at once.
  const pick = (p: FoundPrinter) => void save({ driver: p.driver, address: p.address, name: p.name, paperWidth: cfg?.paperWidth ?? 58, dots: defaultDots(cfg?.paperWidth ?? 58), autoPrint: cfg?.autoPrint ?? true, openDrawer: cfg?.openDrawer ?? false, copies: cfg?.copies ?? 1 });

  return (
    <Screen back title={t('printers.title')}>
      {Platform.OS === 'ios' ? <Banner tone="info" text={t('printers.iosNote')} /> : null}
      <SectionTitle>{t('printers.current')}</SectionTitle>
      {cfg ? (
        <Card>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Icon name="printer" color={colors.primary[600]} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{cfg.name}</Text>
                <Text variant="caption">{cfg.driver === 'spp' ? t('printers.classic') : t('printers.ble')}</Text>
              </View>
            </View>
            <Text variant="label">{t('printers.paper')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label={t('printers.mm58')} selected={cfg.paperWidth === 58} onPress={() => update({ ...cfg, paperWidth: 58, dots: defaultDots(58) })} />
              <Chip label={t('printers.mm80')} selected={cfg.paperWidth === 80} onPress={() => update({ ...cfg, paperWidth: 80, dots: defaultDots(80) })} />
            </View>
            {cfg.paperWidth === 80 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Text variant="caption" style={{ flex: 1 }}>
                  {t('printers.narrowHint')}
                </Text>
                <Switch value={cfg.dots === 512} onValueChange={(v) => update({ ...cfg, dots: v ? 512 : 576 })} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
              </View>
            ) : null}
            {[
              ['autoPrint', t('printers.autoPrint')],
              ['openDrawer', t('printers.drawer')],
            ].map(([k, label]) => (
              <View key={k} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text variant="subtitle" style={{ flex: 1 }}>
                  {label}
                </Text>
                <Switch value={!!cfg[k as 'autoPrint']} onValueChange={(v) => update({ ...cfg, [k as string]: v })} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text variant="subtitle" style={{ flex: 1 }}>
                {t('printers.copies')}
              </Text>
              {[1, 2].map((n) => (
                <Chip key={n} label={String(n)} selected={cfg.copies === n} onPress={() => update({ ...cfg, copies: n })} />
              ))}
            </View>
            <Button compact kind="secondary" icon="printer" title={t('printers.test')} loading={busy} onPress={test} />
            <Button compact kind="ghost" title={t('printers.remove')} onPress={remove} />
          </View>
        </Card>
      ) : (
        <Text variant="caption">{t('printers.none')}</Text>
      )}
      <Button icon="search" title={scanning ? t('printers.scanning') : t('printers.scan')} loading={scanning} onPress={scan} />
      {found.length ? (
        <ListGroup>
          {found.map((p, i) => (
            <ListRow key={p.address} icon="printer" hue={p.paired ? 'primary' : 'ink'} title={p.name} subtitle={`${p.driver === 'spp' ? t('printers.classic') : t('printers.ble')}${p.paired ? ` · ${t('printers.paired')}` : ''}`} onPress={() => pick(p)} last={i === found.length - 1} />
          ))}
        </ListGroup>
      ) : searched && !scanning ? (
        <Banner tone="info" icon="printer" text={t('printers.noneFound')} />
      ) : null}
      <ListGroup>
        <ListRow icon="edit" hue="amber" title={t('templates.title')} subtitle={t('templates.subtitle')} onPress={() => router.push('/settings/templates')} last />
      </ListGroup>
    </Screen>
  );
}
