/** Customers / suppliers list (pure view; container: app/(main)/parties.tsx). */
import { ActivityIndicator, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { Text, TextField, Chip, Avatar, Icon, EmptyState, Fab, colors, fonts, shadow } from '../../ui';
import { Segmented } from '../common/Segmented';
import { balanceLabel, partyColor } from './format';
import { money } from '../../lib/format';
import { AdBanner } from '../ads/AdBanner';

export interface PartyListItem {
  id: string;
  name: string;
  mobile: string | null;
  owedMinor: number;
  lateDays?: number | null;
}

export type PartyFilter = 'all' | 'owing' | 'late' | 'credit';

export function PartiesListView({
  topInset,
  type,
  rows,
  totalOwedMinor,
  count,
  search,
  filter,
  currency,
  lang,
  canAdd,
  onType,
  onSearch,
  onFilter,
  onOpen,
  onAdd,
  onRemind,
  tip,
  loading = false,
}: {
  topInset: number;
  type: 'C' | 'S';
  rows: PartyListItem[];
  totalOwedMinor: number;
  count: number;
  search: string;
  filter: PartyFilter;
  currency: 'EGP' | 'SAR';
  lang: string;
  canAdd: boolean;
  onType: (t: 'C' | 'S') => void;
  onSearch: (q: string) => void;
  onFilter: (f: PartyFilter) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onRemind?: (id: string) => void;
  tip?: React.ReactNode;
  /** First load still running: no empty state yet. */
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const filters: { key: PartyFilter; label: string }[] =
    type === 'C'
      ? [
          { key: 'all', label: t('parties.all') },
          { key: 'owing', label: t('parties.owingC') },
          { key: 'late', label: t('parties.late') },
          { key: 'credit', label: t('parties.creditC') },
        ]
      : [
          { key: 'all', label: t('parties.all') },
          { key: 'owing', label: t('parties.owingS') },
        ];
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper.DEFAULT, paddingTop: topInset }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
        <Text variant="display">{t('parties.title')}</Text>
        <Segmented value={type} onChange={onType} options={[{ value: 'C', label: t('parties.customers') }, { value: 'S', label: t('parties.suppliers') }]} />
        <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: colors.paper.card }, shadow.soft]}>
          <View style={{ flex: 1 }}>
            <Text variant="caption">{t(type === 'C' ? 'parties.totalOwedC' : 'parties.totalOwedS')}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 20, lineHeight: 28, color: type === 'C' ? colors.rose[700] : colors.amber[700] }}>{money(totalOwedMinor, currency, lang)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="caption">{t(type === 'C' ? 'parties.countC' : 'parties.countS')}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 26, color: colors.ink.DEFAULT }}>{count}</Text>
          </View>
        </View>
        {tip}
        <TextField icon="search" placeholder={t('parties.search')} value={search} onChangeText={onSearch} latinDigits={false} />
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {filters.map((f) => (
            <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => onFilter(f.key)} />
          ))}
        </View>
      </View>
      <View style={{ flex: 1, marginTop: 10 }}>
        {rows.length === 0 && loading ? (
          <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 24 }} />
        ) : rows.length === 0 && (search.trim() || filter !== 'all') ? (
          <EmptyState icon="search" hue="sky" title={t('parties.noResults')} />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title={t(type === 'C' ? 'parties.emptyC' : 'parties.emptyS')} body={t('parties.emptyBody')} />
        ) : (
          <FlashList
            data={rows}
            keyExtractor={(r) => r.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            renderItem={({ item }) => {
              const b = balanceLabel(type, item.owedMinor, currency, lang);
              return (
                <Pressable testID={`party-${item.id}`} onPress={() => onOpen(item.id)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
                  <Avatar name={item.name} color={partyColor(item.id)} size={40} />
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink.DEFAULT }}>{item.name}</Text>
                    <Text variant="caption" numberOfLines={1}>
                      {item.lateDays != null ? t('parties.lateDays', { n: item.lateDays }) : item.mobile ? `+${item.mobile}` : t('parties.noMobile')}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: fonts.bold, fontSize: 15.5, lineHeight: 22, color: b.color }}>{b.text}</Text>
                    {item.owedMinor ? <Text style={{ fontFamily: fonts.medium, fontSize: 12, lineHeight: 17, color: b.color }}>{b.tag}</Text> : null}
                  </View>
                  {onRemind && item.lateDays != null && item.mobile ? (
                    <Pressable hitSlop={8} onPress={() => onRemind(item.id)} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.leaf[50] }}>
                      <Icon name="whatsapp" size={20} color={colors.leaf[600]} />
                    </Pressable>
                  ) : null}
                </Pressable>
              );
            }}
          />
        )}
      </View>
      <AdBanner place="parties" />
      {canAdd ? <Fab testID="party-add" onPress={onAdd} /> : null}
    </View>
  );
}
