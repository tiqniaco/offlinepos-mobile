import { Image, Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { splitByUnit } from '@daftarak/shared';
import { Text, Hero, Icon, Card, Button, IconBadge, SectionTitle, Chip, colors } from '../../ui';
import { money, qty, dateTimeLabel } from '../../lib/format';
import { stockTone } from './ProductRow';

export interface DetailData {
  name: string;
  variantLabel: string | null;
  categoryName: string | null;
  imagePath: string | null;
  retailPriceMinor: number;
  wholesalePriceMinor: number;
  costMinor: number;
  trackStock: boolean;
  lowStockMilli: number | null;
  baseUnitName: string;
  larger: { name: string; factorMilli: number; retailPriceMinor: number | null } | null;
  barcodes: string[];
  level: { qtyMilli: number; avgCostMinor: number; valueMinor: number };
  variants: { id: string; variantLabel: string | null }[];
  movements: { id: string; type: string; qtyMilli: number; occurredAt: number; reason: string | null }[];
}

/** Pure view (previewed in the dev gallery). Container: src/app/products/[id].tsx */
export function ProductDetailView({
  id,
  d,
  currency,
  lang,
  canManage,
  canAdjust,
  canSeeCost,
  onAdjust,
  onEdit,
  onAddVariant,
  onDelete,
}: {
  id: string;
  d: DetailData;
  currency: 'EGP' | 'SAR';
  lang: string;
  canManage: boolean;
  canAdjust: boolean;
  canSeeCost: boolean;
  onAdjust: () => void;
  onEdit: () => void;
  onAddVariant: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tone = stockTone({ qtyMilli: d.level.qtyMilli, lowStockMilli: d.lowStockMilli, trackStock: d.trackStock });
  const split = d.larger ? splitByUnit(d.level.qtyMilli, d.larger.factorMilli) : null;
  const toneColor = tone === 'out' ? colors.rose[500] : tone === 'low' ? colors.amber[500] : colors.leaf[500];
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper.DEFAULT }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <Hero>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28, gap: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Pressable onPress={() => router.back()} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="back" color="#FFFFFF" />
              </Pressable>
              {canManage ? (
                <Pressable testID="product-edit" onPress={onEdit} style={{ flexDirection: 'row', gap: 6, alignItems: 'center', height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)' }}>
                  <Icon name="edit" color="#FFFFFF" tint="rgba(255,255,255,0.2)" size={20} />
                  <Text style={{ color: '#FFFFFF', fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 14, lineHeight: 20 }}>{t('product.edit')}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
              <View style={{ width: 84, height: 84, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {d.imagePath ? (
                  <Image source={{ uri: d.imagePath }} style={{ width: 84, height: 84 }} />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 34, lineHeight: 46 }}>{d.name.charAt(0)}</Text>
                )}
              </View>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ color: '#FFFFFF', fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 22, lineHeight: 32 }}>{d.name}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  {d.variantLabel ? <View style={{ backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2 }}><Text style={{ color: colors.accent.onDark, fontSize: 12.5, lineHeight: 19, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{d.variantLabel}</Text></View> : null}
                  {d.categoryName ? <View style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2 }}><Text style={{ color: '#FFFFFF', fontSize: 12.5, lineHeight: 19, fontFamily: 'IBMPlexSansArabic_600SemiBold' }}>{d.categoryName}</Text></View> : null}
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 12 }}>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12.5, lineHeight: 19, fontFamily: 'IBMPlexSansArabic_500Medium' }}>{t('productForm.retail')}</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 20, lineHeight: 30, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{money(d.retailPriceMinor, currency, lang)}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 16, padding: 12 }}>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12.5, lineHeight: 19, fontFamily: 'IBMPlexSansArabic_500Medium' }}>{t('productForm.wholesale')}</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 20, lineHeight: 30, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{money(d.wholesalePriceMinor, currency, lang)}</Text>
              </View>
            </View>
          </View>
        </Hero>

        <View style={{ paddingHorizontal: 20, gap: 14, marginTop: -12 }}>
          {d.trackStock ? (
            <Card>
              <View style={{ gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: toneColor + '1F', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="box" color={toneColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="caption">{t('product.stock')}</Text>
                    <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 26, lineHeight: 36, color: colors.ink.DEFAULT }}>
                      {qty(d.level.qtyMilli)} <Text style={{ fontSize: 16, color: colors.ink.mute }}>{d.baseUnitName}</Text>
                    </Text>
                    {split && d.larger && split.units !== 0 ? (
                      <Text variant="caption">{t('product.inLarger', { units: split.units, large: d.larger.name, rest: qty(split.remainderMilli), small: d.baseUnitName })}</Text>
                    ) : null}
                  </View>
                  {canAdjust ? <Button compact testID="product-adjust" icon="refresh" title={t('product.adjust')} onPress={onAdjust} /> : null}
                </View>
                {tone === 'low' || tone === 'out' ? (
                  <View style={{ backgroundColor: colors.amber[50], borderRadius: 12, padding: 10 }}>
                    <Text style={{ color: colors.amber[700], fontFamily: 'IBMPlexSansArabic_600SemiBold', fontSize: 13.5, lineHeight: 21 }}>{t('product.lowWarning', { qty: qty(d.lowStockMilli ?? 0) })}</Text>
                  </View>
                ) : null}
                {canSeeCost ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, backgroundColor: colors.paper.sunk, borderRadius: 14, padding: 10 }}>
                      <Text variant="caption">{t('product.avgCost')}</Text>
                      <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 15, lineHeight: 23, color: colors.ink.DEFAULT }}>{money(d.level.avgCostMinor || d.costMinor, currency, lang)}</Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: colors.paper.sunk, borderRadius: 14, padding: 10 }}>
                      <Text variant="caption">{t('product.stockValue')}</Text>
                      <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 15, lineHeight: 23, color: colors.ink.DEFAULT }}>{money(d.level.valueMinor, currency, lang)}</Text>
                    </View>
                  </View>
                ) : null}
              </View>
            </Card>
          ) : null}

          {d.larger || d.barcodes.length ? (
            <Card>
              <View style={{ gap: 10 }}>
                {d.larger ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <IconBadge name="layers" hue="amber" size={40} />
                    <View style={{ flex: 1 }}>
                      <Text variant="subtitle">
                        {d.larger.name} = {qty(d.larger.factorMilli)} {d.baseUnitName}
                      </Text>
                      {d.larger.retailPriceMinor != null ? <Text variant="caption">{money(d.larger.retailPriceMinor, currency, lang)}</Text> : null}
                    </View>
                  </View>
                ) : null}
                {d.barcodes.map((b) => (
                  <View key={b} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <IconBadge name="scan" hue="ink" size={40} />
                    <Text style={{ fontFamily: 'IBMPlexSansArabic_600SemiBold', fontSize: 16, lineHeight: 24, letterSpacing: 1, color: colors.ink.DEFAULT }}>{b}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          {d.variants.length > 1 || canManage ? (
            <>
              <SectionTitle>{t('product.variants')}</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {d.variants.map((v) => (
                  <Chip key={v.id} label={v.variantLabel ?? d.name} selected={v.id === id} onPress={() => v.id !== id && router.replace({ pathname: '/products/[id]', params: { id: v.id } })} />
                ))}
                {canManage ? <Chip label={`+ ${t('product.addVariant')}`} onPress={onAddVariant} /> : null}
              </View>
            </>
          ) : null}

          <SectionTitle>{t('product.movements')}</SectionTitle>
          <Card padded={false}>
            {d.movements.length === 0 ? (
              <Text variant="caption" style={{ padding: 16 }}>
                {t('product.noMovements')}
              </Text>
            ) : (
              d.movements.map((m, i) => (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line + '99' }}>
                  <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: m.qtyMilli >= 0 ? colors.leaf[50] : colors.rose[50], alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={m.qtyMilli >= 0 ? 'plus' : 'minus'} size={18} color={m.qtyMilli >= 0 ? colors.leaf[700] : colors.rose[700]} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text variant="subtitle">{t(`movement.${m.type}`)}{m.reason && m.reason !== 'count' ? ` · ${t(`adjust.reasons.${m.reason}`, { defaultValue: m.reason })}` : ''}</Text>
                    <Text variant="caption">{dateTimeLabel(lang, m.occurredAt)}</Text>
                  </View>
                  <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 16, lineHeight: 24, color: m.qtyMilli >= 0 ? colors.leaf[700] : colors.rose[700] }}>
                    {m.qtyMilli > 0 ? '+' : ''}
                    {qty(m.qtyMilli)}
                  </Text>
                </View>
              ))
            )}
          </Card>

          {canManage ? <Button kind="danger" icon="trash" title={t('product.delete')} onPress={onDelete} /> : null}
          <View style={{ height: insets.bottom }} />
        </View>
      </ScrollView>
    </View>
  );
}
