import { Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInUp, FadeOutLeft, LinearTransition } from 'react-native-reanimated';
import { normalizeDigits, type PricedCart } from '@daftarak/shared';
import { Text, Icon, Button, EmptyState, colors, shadow, fonts } from '../../ui';
import { money, qty } from '../../lib/format';
import type { CartLine } from '../../domain/sales/sales';
import { ProductThumb } from '../inventory/ProductRow';

export interface SearchHit {
  id: string;
  name: string;
  variantLabel: string | null;
  retailPriceMinor: number;
  qtyMilli: number;
  unitName: string;
  imagePath: string | null;
  categoryColor: string | null;
}

function Stepper({ value, onMinus, onPlus }: { value: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, direction: 'ltr', backgroundColor: colors.paper.sunk, borderRadius: 14, padding: 3 }}>
      <Pressable hitSlop={6} onPress={onMinus} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.paper.line : colors.paper.card })}>
        <Icon name="minus" size={18} color={colors.ink.soft} />
      </Pressable>
      <Text style={{ minWidth: 34, textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink.DEFAULT }}>{value}</Text>
      <Pressable hitSlop={6} onPress={onPlus} style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.primary[100] : colors.primary[50] })}>
        <Icon name="plus" size={18} color={colors.primary[700]} />
      </Pressable>
    </View>
  );
}

/** Pure view of the POS (previewed in the dev gallery). Container: src/app/(main)/sell.tsx */
export function PosView(p: {
  topInset: number;
  lines: CartLine[];
  priced: PricedCart | null;
  /** Offer names per line key, coupon label. */
  offerNames?: Record<string, string>;
  couponLabel?: string | null;
  onCoupon?: () => void;
  lastKey: string | null;
  customerName: string | null;
  customerNote: string | null;
  search: string;
  hits: SearchHit[];
  currency: 'EGP' | 'SAR';
  lang: string;
  vatLabel: string | null;
  pricesIncludeVat: boolean;
  parkedCount: number;
  onSearch: (v: string) => void;
  onSubmitSearch: () => void;
  onScan: () => void;
  onPickHit: (id: string) => void;
  onQty: (key: string, qtyMilli: number) => void;
  onLine: (key: string) => void;
  onCustomer: () => void;
  onMenu: () => void;
  onPark: () => void;
  onPay: () => void;
  onDiscount: () => void;
}) {
  const { t } = useTranslation();
  const lines = [...p.lines].reverse(); // last added on top
  const totals = p.priced;
  const showHits = p.search.trim().length > 0 && p.hits.length > 0;
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper.DEFAULT, paddingTop: p.topInset }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Pressable testID="pos-customer" onPress={p.onCustomer} style={({ pressed }) => [{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 16, paddingHorizontal: 12, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
            <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: p.customerName ? colors.primary[50] : colors.paper.sunk, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="users" size={18} color={p.customerName ? colors.primary[600] : colors.ink.mute} />
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.ink.DEFAULT }}>{p.customerName ?? t('pos.walkIn')}</Text>
              {p.customerNote ? <Text variant="caption" numberOfLines={1}>{p.customerNote}</Text> : null}
            </View>
            <Icon name="chevron" size={16} color={colors.ink.faint} />
          </Pressable>
          <Pressable testID="pos-menu" onPress={p.onMenu} style={({ pressed }) => [{ width: 48, height: 48, borderRadius: 16, backgroundColor: colors.paper.card, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.8 : 1 }, shadow.soft]}>
            <Icon name="dots" color={colors.ink.DEFAULT} />
            {p.parkedCount ? (
              <View style={{ position: 'absolute', top: -4, end: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.amber[500], alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 11, lineHeight: 16 }}>{p.parkedCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
        {/* Search / scanner input — hardware scanners type here and press Enter. */}
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 54, borderRadius: 18, backgroundColor: colors.paper.card, paddingStart: 14, paddingEnd: 6, borderWidth: 2, borderColor: colors.primary[100] }, shadow.soft]}>
          <Icon name="search" color={colors.ink.faint} size={22} />
          <TextInput
            testID="pos-search"
            value={p.search}
            onChangeText={(v) => p.onSearch(normalizeDigits(v))}
            onSubmitEditing={p.onSubmitSearch}
            blurOnSubmit={false}
            placeholder={t('pos.search')}
            placeholderTextColor={colors.ink.faint}
            returnKeyType="search"
            style={[{ flex: 1, minWidth: 0, height: '100%', fontSize: 16, fontFamily: fonts.medium, color: colors.ink.DEFAULT, textAlign: 'auto' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          />
          <Pressable testID="pos-scan" onPress={p.onScan} style={({ pressed }) => ({ height: 44, paddingHorizontal: 14, borderRadius: 14, backgroundColor: pressed ? colors.primary[700] : colors.primary[600], flexDirection: 'row', alignItems: 'center', gap: 6 })}>
            <Icon name="scan" color="#FFFFFF" tint="rgba(255,255,255,0.2)" size={22} />
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {lines.length === 0 ? (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
            <EmptyState icon="scan" hue="primary" title={t('pos.emptyTitle')} body={t('pos.emptyBody')}>
              <Button icon="camera" title={t('scan.title')} onPress={p.onScan} />
            </EmptyState>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            {lines.map((l, i) => {
              const pl = totals?.lines.find((x) => x.key === l.key);
              const fresh = l.key === p.lastKey && i === 0;
              return (
                <Animated.View key={l.key} entering={FadeInUp.springify().damping(18)} exiting={FadeOutLeft.duration(160)} layout={LinearTransition.springify().damping(20)}>
                <Pressable
                  onPress={() => p.onLine(l.key)}
                  style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: fresh ? colors.primary[50] : colors.paper.card, borderWidth: 1.5, borderColor: fresh ? colors.primary[200] : 'transparent', opacity: pressed ? 0.9 : 1 }, shadow.soft]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text numberOfLines={2} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{l.name}</Text>
                    <Text variant="caption">
                      {money(l.unitPriceMinor, p.currency, p.lang)} / {l.unitName}
                      {pl && pl.lineDiscountMinor ? `  ·  −${money(pl.lineDiscountMinor, p.currency, p.lang)}` : ''}
                    </Text>
                    {pl && pl.offerDiscountMinor ? (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.leaf[50], borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
                        <Icon name="tag" size={13} color={colors.leaf[700]} />
                        <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17, color: colors.leaf[700] }}>
                          {p.offerNames?.[l.key] ?? t('offers.badge')} −{money(pl.offerDiscountMinor, p.currency, p.lang)}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.ink.DEFAULT }}>{money(pl?.amountMinor ?? 0, p.currency, p.lang)}</Text>
                    <Stepper value={qty(l.qtyMilli)} onMinus={() => p.onQty(l.key, l.qtyMilli - 1000)} onPlus={() => p.onQty(l.key, l.qtyMilli + 1000)} />
                  </View>
                </Pressable>
                </Animated.View>
              );
            })}
          </ScrollView>
        )}

        {showHits ? (
          <View style={[{ position: 'absolute', top: 6, left: 16, right: 16, maxHeight: 360, borderRadius: 18, backgroundColor: colors.paper.card, overflow: 'hidden' }, shadow.lifted]}>
            <ScrollView keyboardShouldPersistTaps="always">
              {p.hits.map((h, i) => (
                <Pressable key={h.id} onPress={() => p.onPickHit(h.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: pressed ? colors.paper.sunk : 'transparent', borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line })}>
                  <ProductThumb name={h.name} imagePath={h.imagePath} color={h.categoryColor} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>
                      {h.name}
                      {h.variantLabel ? ` · ${h.variantLabel}` : ''}
                    </Text>
                    <Text variant="caption">{t('pos.lowStock', { qty: `${qty(h.qtyMilli)} ${h.unitName}` })}</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.primary[700] }}>{money(h.retailPriceMinor, p.currency, p.lang)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>

      {/* Totals + actions (thumb zone) */}
      {lines.length ? (
        <View style={[{ backgroundColor: colors.paper.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 10 }, shadow.lifted]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text variant="caption">{t('pos.items', { n: lines.length })}</Text>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              {p.onCoupon ? (
                <Pressable testID="pos-coupon" onPress={p.onCoupon} hitSlop={8}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 20, color: p.couponLabel ? colors.leaf[700] : colors.primary[700] }}>
                    {p.couponLabel ?? `+ ${t('offers.coupon')}`}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable onPress={p.onDiscount} hitSlop={8}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 13.5, lineHeight: 20, color: colors.primary[700] }}>
                  {totals && totals.lineDiscountMinor + totals.invoiceDiscountMinor > 0 ? `${t('pos.discount')}: −${money(totals.lineDiscountMinor + totals.invoiceDiscountMinor, p.currency, p.lang)}` : `+ ${t('pos.invoiceDiscount')}`}
                </Text>
              </Pressable>
            </View>
          </View>
          {totals && totals.offerDiscountMinor + totals.couponMinor > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.leaf[700] }}>{t('offers.saved')}</Text>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19, color: colors.leaf[700] }}>−{money(totals.offerDiscountMinor + totals.couponMinor, p.currency, p.lang)}</Text>
            </View>
          ) : null}
          {totals && p.vatLabel ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption">{p.pricesIncludeVat ? `${p.vatLabel} (${t('pos.vatIncluded')})` : p.vatLabel}</Text>
              <Text variant="caption">{money(totals.taxMinor, p.currency, p.lang)}</Text>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable testID="pos-park" onPress={p.onPark} style={({ pressed }) => ({ width: 64, height: 60, borderRadius: 18, backgroundColor: pressed ? colors.paper.line : colors.paper.sunk, alignItems: 'center', justifyContent: 'center', gap: 2 })}>
              <Icon name="clipboard" color={colors.ink.soft} size={22} />
              <Text style={{ fontFamily: fonts.semibold, fontSize: 11.5, lineHeight: 16, color: colors.ink.soft }}>{t('pos.park')}</Text>
            </Pressable>
            <Pressable testID="pos-pay" onPress={p.onPay} style={({ pressed }) => [{ flex: 1, height: 60, borderRadius: 18, overflow: 'hidden', transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
              <View style={{ flex: 1, backgroundColor: colors.primary[600], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 }}>
                <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 19, lineHeight: 26 }}>{t('pos.payShort')}</Text>
                <Text style={{ color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 24, lineHeight: 32 }}>{money(totals?.totalMinor ?? 0, p.currency, p.lang)}</Text>
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
