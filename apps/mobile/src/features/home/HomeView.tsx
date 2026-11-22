import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, Hero, Avatar, Card, IconBadge, Icon, colors, type IconName, type Hue } from '../../ui';

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
      <Text style={{ color: '#FFFFFF', fontSize: 12.5, lineHeight: 19, fontFamily: 'IBMPlexSansArabic_600SemiBold' }}>{children}</Text>
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
}) {
  const { t } = useTranslation();
  const done = tasks.filter((x) => x.done).length;
  const total = tasks.filter((x) => !x.soon).length;
  return (
    <ScrollView className="flex-1 bg-paper" contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
      <Hero>
        <View className="gap-5 px-5 pb-8 pt-4">
          <View className="flex-row items-center gap-3">
            <Avatar name={userName} color={userColor} size={46} ring />
            <View className="flex-1">
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, lineHeight: 20, fontFamily: 'IBMPlexSansArabic_500Medium' }}>{dateLabel}</Text>
              <Text style={{ color: '#FFFFFF', fontSize: 19, lineHeight: 28, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{greeting}</Text>
            </View>
            <Pressable testID="home-lock" accessibilityRole="button" onPress={onLock} style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', opacity: pressed ? 0.7 : 1 })}>
              <Icon name="lock" color="#FFFFFF" tint="rgba(255,255,255,0.2)" />
            </Pressable>
          </View>
          <View className="gap-2">
            <Text style={{ color: '#FFFFFF', fontSize: 30, lineHeight: 42, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{businessName}</Text>
            <View className="flex-row flex-wrap gap-2">
              <Chip dot="#7CE0A0">{t('home.offline')}</Chip>
              {planChip ? <Chip>{planChip}</Chip> : null}
            </View>
          </View>
        </View>
      </Hero>

      <View className="gap-4 px-5" style={{ marginTop: -14 }}>
        {banner}
        <Card padded={false}>
          <View className="gap-3 px-4 pb-2 pt-4">
            <View className="flex-row items-center justify-between">
              <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 18, lineHeight: 28, color: colors.ink.DEFAULT }}>{t('home.setupTitle')}</Text>
              <Text variant="caption">{t('home.setupProgress', { done, total })}</Text>
            </View>
            <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
              <View style={{ width: `${total ? (done / total) * 100 : 0}%`, height: 8, borderRadius: 4, backgroundColor: colors.teal[500] }} />
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
                    fontFamily: 'IBMPlexSansArabic_600SemiBold',
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
                    <Text style={{ color: colors.amber[700], fontSize: 12, lineHeight: 18, fontFamily: 'IBMPlexSansArabic_700Bold' }}>{t('home.soon')}</Text>
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

        <Card>
          <View className="flex-row items-center gap-3">
            <IconBadge name="shield" hue="sky" size={48} />
            <View className="flex-1">
              <Text style={{ fontFamily: 'IBMPlexSansArabic_700Bold', fontSize: 16, lineHeight: 24, color: colors.ink.DEFAULT }}>{t('home.safeTitle')}</Text>
              <Text variant="caption">{t('home.safeBody')}</Text>
            </View>
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
