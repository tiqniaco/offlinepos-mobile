/**
 * «أضف أصنافك بسرعة» — the fastest ways to get a shop's items (and their quantities) in:
 * a) photograph a supplier invoice → purchase (unknown items become new products, stock comes in);
 * b) photograph any list of items (handwritten / printed stock list) → products + opening stock;
 * c) scan barcodes one after the other → new items get a short form, known ones +1 → opening stock;
 * d) Excel import (template with quantity columns).
 * Opened from the empty products tab, the products menu and the home setup task.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Icon, IconBadge, Banner, colors, fonts, shadow, type Hue, type IconName } from '../../ui';
import { Pressable } from '../../ui/Press';
import { ScanInvoiceButton } from '../../features/purchases/ScanInvoice';
import { shareImportTemplate } from '../../features/inventory/excel';
import { useCan } from '../../features/inventory/useInvCtx';
import { useProductSlots } from '../../features/inventory/usePricing';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';

function Tile({ testID, icon, hue, title, hint, badge, onPress, disabled, children }: { testID: string; icon: IconName; hue: Hue; title: string; hint: string; badge?: string | null; onPress?: () => void; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      disabled={disabled || !onPress}
      style={({ pressed }) => [{ gap: 10, padding: 16, borderRadius: 20, backgroundColor: colors.paper.card, opacity: disabled ? 0.55 : pressed ? 0.88 : 1 }, shadow.soft]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <IconBadge name={icon} hue={hue} size={54} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 26, color: colors.ink.DEFAULT }}>{title}</Text>
          <Text style={{ fontSize: 13, lineHeight: 20, color: colors.ink.mute }}>{hint}</Text>
          {badge ? <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: colors.primary[700] }}>{badge}</Text> : null}
        </View>
        {onPress ? <Icon name="chevron" size={16} color={colors.ink.faint} /> : null}
      </View>
      {children}
    </Pressable>
  );
}

export default function QuickAdd() {
  const { t } = useTranslation();
  const manage = useCan('products.manage');
  const purchases = useCan('purchases.manage');
  const adjust = useCan('stock.adjust');
  const slots = useProductSlots();
  const [sharing, setSharing] = useState(false);

  const template = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      await shareImportTemplate();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      setSharing(false);
    }
  };
  const scansLeft = (p: { left: number | null; unlimited: boolean; paid: boolean }) => (!p.paid ? t('ocr.paidOnly') : p.left != null ? t('ocr.left', { n: p.left }) : p.unlimited ? t('ocr.leftUnlimited') : t('ocr.needsNet'));

  return (
    <Screen back title={t('quickAdd.title')} subtitle={t('quickAdd.subtitle')}>
      {!manage ? <Banner tone="warn" text={t('users.noPermission')} /> : null}
      {slots != null ? <Banner tone={slots > 0 ? 'info' : 'danger'} text={slots > 0 ? t('quickAdd.slotsLeft', { n: slots }) : t('quickAdd.limitNone', { n: 1 })} /> : null}

      {purchases ? (
        <Tile testID="quick-invoice" icon="receipt" hue="primary" title={t('quickAdd.invoiceTitle')} hint={t('quickAdd.invoiceHint')} onPress={() => router.push({ pathname: '/purchases/new', params: { scan: '1' } })} />
      ) : null}

      {manage ? (
        <ScanInvoiceButton
          mode="list"
          trigger={(p) => <Tile testID="quick-list" icon="camera" hue="amber" title={t('quickAdd.listTitle')} hint={t('quickAdd.listHint')} badge={scansLeft(p)} disabled={p.reading} onPress={p.open} />}
        />
      ) : null}

      {manage ? <Tile testID="quick-scan" icon="scan" hue="sky" title={t('quickAdd.scanTitle')} hint={adjust ? t('quickAdd.scanHint') : t('quickAdd.scanHintNoStock')} onPress={() => router.push('/products/scan-add')} /> : null}

      {manage ? (
        <Tile testID="quick-excel" icon="sheet" hue="leaf" title={t('quickAdd.excelTitle')} hint={t('quickAdd.excelHint')} onPress={() => router.push('/products/import')}>
          <Pressable testID="quick-excel-template" onPress={() => void template()} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 99, backgroundColor: pressed ? colors.leaf[100] : colors.leaf[50] })}>
            <Icon name="download" size={15} color={colors.leaf[700]} />
            <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: colors.leaf[700] }}>{sharing ? t('common.loading') : t('quickAdd.template')}</Text>
          </Pressable>
        </Tile>
      ) : null}

      {manage ? (
        <Pressable testID="quick-one" onPress={() => router.push('/products/form')} style={{ alignSelf: 'center', padding: 10 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary[700] }}>{t('quickAdd.oneByOne')}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
}
