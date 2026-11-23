import { Image, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { fonts } from '../../ui/fonts';
import { useTranslation } from 'react-i18next';
import { Text, Icon, colors, shadow } from '../../ui';
import { money, qty } from '../../lib/format';

export interface ProductRowData {
  id: string;
  name: string;
  variantLabel: string | null;
  retailPriceMinor: number;
  trackStock: boolean;
  lowStockMilli: number | null;
  imagePath: string | null;
  qtyMilli: number;
  unitName: string;
  categoryColor?: string | null;
}

/** Stock badge colour: red = none/negative, amber = at/below alert, green = fine. */
export function stockTone(p: Pick<ProductRowData, 'qtyMilli' | 'lowStockMilli' | 'trackStock'>): 'ok' | 'low' | 'out' | 'none' {
  if (!p.trackStock) return 'none';
  if (p.qtyMilli <= 0) return 'out';
  if (p.lowStockMilli != null && p.qtyMilli <= p.lowStockMilli) return 'low';
  return 'ok';
}

const tones = () => ({
  ok: { bg: colors.leaf[50], fg: colors.leaf[700] },
  low: { bg: colors.amber[50], fg: colors.amber[700] },
  out: { bg: colors.rose[50], fg: colors.rose[700] },
  none: { bg: colors.paper.sunk, fg: colors.ink.mute },
});

export function ProductThumb({ name, imagePath, color, size = 52 }: { name: string; imagePath: string | null; color?: string | null; size?: number }) {
  if (imagePath) return <Image source={{ uri: imagePath }} style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: colors.paper.sunk }} />;
  const c = color ?? colors.primary[500];
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: c + '1F', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c, fontFamily: fonts.bold, fontSize: size * 0.4, lineHeight: size * 0.55 }}>{name.trim().charAt(0)}</Text>
    </View>
  );
}

export function ProductRow({ p, currency, lang, selected, selecting, onPress, onLongPress }: { p: ProductRowData; currency: 'EGP' | 'SAR'; lang: string; selected?: boolean; selecting?: boolean; onPress: () => void; onLongPress?: () => void }) {
  const { t } = useTranslation();
  const tone = stockTone(p);
  const TONE = tones();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      style={({ pressed }) => [
        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: selected ? colors.primary[50] : colors.paper.card, borderWidth: 1.5, borderColor: selected ? colors.primary[400] : 'transparent', opacity: pressed ? 0.85 : 1 },
        shadow.soft,
      ]}
    >
      {selecting ? (
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selected ? colors.primary[600] : colors.paper.line, backgroundColor: selected ? colors.primary[600] : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
        </View>
      ) : null}
      <ProductThumb name={p.name} imagePath={p.imagePath} color={p.categoryColor} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.bold, fontSize: 15.5, lineHeight: 23, color: colors.ink.DEFAULT }}>
          {p.name}
          {p.variantLabel ? <Text style={{ color: colors.ink.mute, fontFamily: fonts.medium }}>{`  ·  ${p.variantLabel}`}</Text> : null}
        </Text>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.primary[700] }}>{money(p.retailPriceMinor, currency, lang)}</Text>
      </View>
      <View style={{ backgroundColor: TONE[tone].bg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, minWidth: 64, alignItems: 'center' }}>
        <Text style={{ fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, color: TONE[tone].fg }}>{tone === 'none' ? '—' : qty(p.qtyMilli)}</Text>
        <Text style={{ fontSize: 11, lineHeight: 15, color: TONE[tone].fg, fontFamily: fonts.medium }}>{tone === 'none' ? t('products.notTracked') : p.unitName}</Text>
      </View>
    </Pressable>
  );
}
