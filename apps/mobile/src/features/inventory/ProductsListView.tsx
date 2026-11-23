import { ScrollView, TextInput, View, Platform } from 'react-native';
import { Pressable } from '../../ui/Press';
import { fonts } from '../../ui/fonts';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { normalizeDigits } from '@daftarak/shared';
import { Text, Icon, Chip, Fab, EmptyState, Button, colors, shadow } from '../../ui';
import { ProductRow, type ProductRowData } from './ProductRow';
import { money } from '../../lib/format';

export interface CategoryChip {
  id: string;
  name: string;
  color: string | null;
  products: number;
}

/** Pure view of the products tab (previewed in the dev gallery). Container: src/app/(main)/products.tsx */
export function ProductsListView(props: {
  rows: ProductRowData[];
  loading: boolean;
  search: string;
  onSearch: (v: string) => void;
  onSubmitSearch: () => void;
  onScan: () => void;
  filter: { kind: 'all' } | { kind: 'low' } | { kind: 'category'; id: string };
  onFilter: (f: { kind: 'all' } | { kind: 'low' } | { kind: 'category'; id: string }) => void;
  categories: CategoryChip[];
  summary: { products: number; lowStock: number; stockValueMinor: number } | null;
  showValue: boolean;
  currency: 'EGP' | 'SAR';
  lang: string;
  selecting: boolean;
  selected: Set<string>;
  onPressRow: (id: string) => void;
  onLongPressRow: (id: string) => void;
  onEndReached: () => void;
  onAdd: () => void;
  onImport: () => void;
  onMenu: () => void;
  onCancelSelect: () => void;
  onBulkPrice: () => void;
  onBulkCategory: () => void;
  canManage: boolean;
  topInset: number;
}) {
  const { t } = useTranslation();
  const p = props;
  const empty = !p.loading && p.rows.length === 0;
  const searching = p.search.trim().length > 0;
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper.DEFAULT, paddingTop: p.topInset }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          {p.selecting ? (
            <>
              <Text style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.ink.DEFAULT }}>{t('products.selected', { n: p.selected.size })}</Text>
              <Button compact kind="ghost" title={t('common.cancel')} onPress={p.onCancelSelect} />
            </>
          ) : (
            <>
              <View>
                <Text style={{ fontFamily: fonts.bold, fontSize: 26, lineHeight: 38, color: colors.ink.DEFAULT }}>{t('products.title')}</Text>
                {p.summary ? (
                  <Text variant="caption">
                    {t('products.count', { n: p.summary.products })}
                    {p.showValue ? `  ·  ${t('products.value')} ${money(p.summary.stockValueMinor, p.currency, p.lang)}` : ''}
                  </Text>
                ) : null}
              </View>
              <Pressable testID="products-menu" onPress={p.onMenu} hitSlop={8} style={({ pressed }) => [{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.paper.card, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 }, shadow.soft]}>
                <Icon name="dots" color={colors.ink.DEFAULT} />
              </Pressable>
            </>
          )}
        </View>

        {/* Search: also receives hardware scanner input (types the code + Enter). */}
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 52, borderRadius: 16, backgroundColor: colors.paper.card, paddingStart: 14, paddingEnd: 6 }, shadow.soft]}>
          <Icon name="search" color={colors.ink.faint} size={22} />
          <TextInput
          maxFontSizeMultiplier={1.15}
            testID="products-search"
            value={p.search}
            onChangeText={(v) => p.onSearch(normalizeDigits(v))}
            onSubmitEditing={p.onSubmitSearch}
            placeholder={t('products.search')}
            placeholderTextColor={colors.ink.faint}
            returnKeyType="search"
            style={[{ flex: 1, minWidth: 0, height: '100%', fontSize: 16, fontFamily: fonts.medium, color: colors.ink.DEFAULT, textAlign: 'auto' }, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
          />
          <Pressable testID="products-scan" onPress={p.onScan} style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 12, backgroundColor: pressed ? colors.primary[100] : colors.primary[50], alignItems: 'center', justifyContent: 'center' })}>
            <Icon name="scan" color={colors.primary[700]} />
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
          <Chip label={t('products.all')} selected={p.filter.kind === 'all'} onPress={() => p.onFilter({ kind: 'all' })} />
          <Chip label={t('products.low')} dot={colors.amber[500]} count={p.summary?.lowStock} selected={p.filter.kind === 'low'} onPress={() => p.onFilter({ kind: 'low' })} />
          {p.categories.map((c) => (
            <Chip key={c.id} label={c.name} dot={c.color} selected={p.filter.kind === 'category' && p.filter.id === c.id} onPress={() => p.onFilter({ kind: 'category', id: c.id })} />
          ))}
        </ScrollView>
      </View>

      {empty ? (
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20 }}>
          {searching ? (
            <EmptyState icon="search" hue="ink" title={t('products.noResults', { q: p.search })}>
              {p.canManage ? <Button kind="secondary" icon="plus" title={t('products.addWithBarcode')} onPress={p.onAdd} /> : null}
            </EmptyState>
          ) : (
            <EmptyState icon="box" hue="amber" title={t('products.emptyTitle')} body={t('products.emptyBody')}>
              {p.canManage ? (
                <>
                  <Button icon="plus" title={t('products.add')} onPress={p.onAdd} />
                  <Button kind="secondary" icon="upload" title={t('products.import')} onPress={p.onImport} />
                </>
              ) : null}
            </EmptyState>
          )}
        </ScrollView>
      ) : (
        <FlashList
          data={p.rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 110 }}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          onEndReached={p.onEndReached}
          onEndReachedThreshold={0.5}
          extraData={[p.selected, p.selecting]}
          renderItem={({ item }) => (
            <ProductRow
              p={item}
              currency={p.currency}
              lang={p.lang}
              selecting={p.selecting}
              selected={p.selected.has(item.id)}
              onPress={() => p.onPressRow(item.id)}
              onLongPress={p.canManage ? () => p.onLongPressRow(item.id) : undefined}
            />
          )}
        />
      )}

      {p.selecting ? (
        <View style={[{ position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', gap: 10, padding: 10, borderRadius: 20, backgroundColor: colors.paper.card }, shadow.lifted]}>
          <View style={{ flex: 1 }}>
            <Button compact icon="tag" title={t('products.bulkPrice')} disabled={!p.selected.size} onPress={p.onBulkPrice} />
          </View>
          <View style={{ flex: 1 }}>
            <Button compact kind="secondary" icon="layers" title={t('products.bulkCategory')} disabled={!p.selected.size} onPress={p.onBulkCategory} />
          </View>
        </View>
      ) : p.canManage && !empty ? (
        <Fab testID="products-add" onPress={p.onAdd} />
      ) : null}
    </View>
  );
}
