import { ScrollView, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { fonts } from '../../ui/fonts';
import { useTranslation } from 'react-i18next';
import { Text, Hero, Avatar, Card, IconBadge, Icon, Button, SectionTitle, colors, type IconName, type Hue } from '../../ui';
import { ActionTiles, type Tile } from '../common/ActionTiles';
import { AdBanner } from '../ads/AdBanner';

export interface SetupTask {
  key: string;
  title: string;
  icon: IconName;
  hue: Hue;
  done: boolean;
  soon?: boolean;
  onPress?: () => void;
}

function Chip({ children, dot }: { children: string; dot?: string }) {
  return (
    <View className="flex-row items-center gap-1.5" style={{ backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 99, paddingHorizontal: 11, paddingVertical: 5 }}>
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} /> : null}
      <Text style={{ color: '#FFFFFF', fontSize: 12.5, lineHeight: 19, fontFamily: fonts.semibold }}>{children}</Text>
    </View>
  );
}

/** Pure view so it can be previewed in the dev gallery. Container: src/app/(main)/index.tsx */
export function HomeView({
  greeting,
  userName,
  userColor,
  businessName,
  dateLabel,
  planChip,
  banner,
  tasks,
  onLock,
  onSearch,
  onInbox,
  unread = 0,
  stats,
  onSell,
  quick,
  alerts,
}: {
  greeting: string;
  userName: string;
  userColor: string;
  businessName: string;
  dateLabel: string;
  planChip: string | null;
  banner?: React.ReactNode;
  tasks: SetupTask[];
  onLock: () => void;
  onSearch?: () => void;
  /** Messages from Daftarak (bell + unread dot). */
  onInbox?: () => void;
  unread?: number;
  stats?: { key: string; label: string; value: string; icon: IconName; hue: Hue; onPress?: () => void }[];
  onSell?: () => void;
  quick?: Tile[];
  alerts?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const done = tasks.filter((x) => x.done).length;
  const total = tasks.filter((x) => !x.soon).length;
  return (
    <ScrollView className="flex-1 bg-paper" contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
      <Hero>
        <View className="gap-4 px-4 pb-7 pt-3">
          <View className="flex-row items-center gap-3">
            <Avatar name={userName} color={userColor} size={40} ring />
            <View className="flex-1">
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 20, fontFamily: fonts.medium }}>{dateLabel}</Text>
              <Text style={{ color: '#FFFFFF', fontSize: 19, lineHeight: 28, fontFamily: fonts.bold }}>{greeting}</Text>
            </View>
            {onSearch ? (
              <Pressable testID="home-search" accessibilityRole="search" onPress={onSearch} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.7 : 1 })}>
                <Icon name="search" size={20} color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
              </Pressable>
            ) : null}
            {onInbox ? (
              <Pressable testID="home-inbox" accessibilityRole="button" accessibilityLabel={t('inbox.title')} onPress={onInbox} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.7 : 1 })}>
                <Icon name="bell" size={20} color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
                {unread > 0 ? (
                  <View style={{ position: 'absolute', top: 4, end: 4, minWidth: 16, height: 16, paddingHorizontal: 3, borderRadius: 8, backgroundColor: colors.rose[500], alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#FFFFFF' }}>
                    <Text style={{ color: '#FFFFFF', fontSize: 9, lineHeight: 12, fontFamily: fonts.bold }}>{unread > 9 ? '9+' : unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            ) : null}
            <Pressable testID="home-lock" accessibilityRole="button" onPress={onLock} style={({ pressed }) => ({ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.7 : 1 })}>
              <Icon name="lock" color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
            </Pressable>
          </View>
          <View className="gap-2">
            <Text style={{ color: '#FFFFFF', fontSize: 27, lineHeight: 38, fontFamily: fonts.bold }}>{businessName}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip dot="#7CE0A0">{t('home.offline')}</Chip>
              {planChip ? <Chip>{planChip}</Chip> : null}
            </View>
          </View>
        </View>
      </Hero>

      <View className="gap-3 px-4" style={{ marginTop: 12 }}>
        {banner}
        {onSell ? <Button testID="home-sell" icon="scan" title={t('home.startSale')} onPress={onSell} /> : null}
        {stats && stats.length ? (
          <>
            <SectionTitle>{t('home.summary')}</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {stats.map((st) => (
                <Card key={st.key} onPress={st.onPress} padded={false} style={{ flexBasis: '31%', flexGrow: 1, paddingVertical: 10, paddingHorizontal: 10 }}>
                  <View style={{ gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <IconBadge name={st.icon} hue={st.hue} size={22} />
                      <Text variant="caption" numberOfLines={1} style={{ flex: 1 }}>
                        {st.label}
                      </Text>
                    </View>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.ink.DEFAULT }}>
                      {st.value}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          </>
        ) : null}
        {alerts}
        {quick && quick.length ? (
          <>
            <SectionTitle>{t('quick.title')}</SectionTitle>
            <ActionTiles tiles={quick} columns={4} />
          </>
        ) : null}
        {done < total || tasks.some((x) => x.soon) ? (
        <Card padded={false}>
          <View className="gap-3 px-4 pb-2 pt-4">
            <View className="flex-row items-center justify-between">
              <Text style={{ fontFamily: fonts.bold, fontSize: 18, lineHeight: 28, color: colors.ink.DEFAULT }}>{t('home.setupTitle')}</Text>
              <Text variant="caption">{t('home.setupProgress', { done, total })}</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
              <View style={{ width: `${total ? (done / total) * 100 : 0}%`, height: 8, borderRadius: 4, backgroundColor: colors.primary[500] }} />
            </View>
          </View>
          {tasks.map((task, i) => (
            <Pressable
              key={task.key}
              disabled={!task.onPress || task.soon}
              onPress={task.onPress}
              style={({ pressed }) => ({ backgroundColor: pressed ? colors.paper.sunk : 'transparent', borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.paper.line + '99' })}
            >
              <View className="flex-row items-center gap-3 px-4 py-3" style={{ opacity: task.soon ? 0.6 : 1 }}>
                <IconBadge name={task.icon} hue={task.done ? 'leaf' : task.hue} size={40} />
                <Text
                  style={{
                    flex: 1,
                    fontFamily: fonts.semibold,
                    fontSize: 15,
                    lineHeight: 23,
                    color: task.done ? colors.ink.mute : colors.ink.DEFAULT,
                    textDecorationLine: task.done ? 'line-through' : 'none',
                  }}
                >
                  {task.title}
                </Text>
                {task.soon ? (
                  <View style={{ backgroundColor: colors.amber[50], borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: colors.amber[700], fontSize: 12, lineHeight: 18, fontFamily: fonts.bold }}>{t('home.soon')}</Text>
                  </View>
                ) : task.done ? (
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.leaf[500], alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="check" size={15} color="#FFFFFF" />
                  </View>
                ) : (
                  <Icon name="chevron" size={18} color={colors.ink.faint} />
                )}
              </View>
            </Pressable>
          ))}
        </Card>
        ) : null}

        <Card>
          <View className="flex-row items-center gap-3">
            <IconBadge name="shield" hue="sky" size={38} />
            <View className="flex-1">
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{t('home.safeTitle')}</Text>
              <Text variant="caption">{t('home.safeBody')}</Text>
            </View>
          </View>
        </Card>
        <AdBanner place="home" />
      </View>
    </ScrollView>
  );
}
