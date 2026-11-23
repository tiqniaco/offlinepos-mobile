/** Home "your plan" card: the active plan, its state (trial days left…), and how much of each limit is used. */
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text, Card, Icon, colors, fonts } from '../../ui';
import { Pressable } from '../../ui/Press';
import { usedShare, type UsageRow } from '../../domain/licence/usage';

export function PlanCard({ planName, status, tone, usage, upgradeLabel, onPress }: {
  planName: string;
  status: string;
  tone: 'free' | 'trial' | 'paid' | 'warn';
  usage: UsageRow[];
  /** Shown as a button when the shop can upgrade (free / trial). */
  upgradeLabel?: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const chip = tone === 'paid' ? colors.leaf : tone === 'warn' ? colors.rose : tone === 'trial' ? colors.amber : colors.sky;
  return (
    <Pressable testID="home-plan-card" onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary[50] }}>
            <Icon name="card" size={19} color={colors.primary[700]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 11.5, color: colors.ink.mute }}>{t('planCard.active')}</Text>
            <Text style={{ fontFamily: fonts.bold, fontSize: 15.5, color: colors.ink.DEFAULT }}>{planName}</Text>
          </View>
          <View style={{ paddingHorizontal: 9, paddingVertical: 2, borderRadius: 99, backgroundColor: chip[100] }}>
            <Text style={{ fontFamily: fonts.bold, fontSize: 11.5, color: chip[700] }}>{status}</Text>
          </View>
        </View>
        <View style={{ gap: 9, marginTop: 12 }}>
          {usage.map((r) => {
            const unlimited = r.limit < 0;
            const share = usedShare(r);
            const bar = share >= 0.9 ? colors.rose[500] : share >= 0.7 ? colors.amber[500] : colors.primary[500];
            return (
              <View key={r.key} style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ fontSize: 12.5, color: colors.ink.soft }}>{t(`planCard.k.${r.key}`)}</Text>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: share >= 0.9 ? colors.rose[700] : colors.ink.DEFAULT }}>
                    {unlimited ? t('planCard.usedUnlimited', { used: r.used }) : t('planCard.used', { used: r.used, limit: r.limit, left: Math.max(0, r.limit - r.used) })}
                  </Text>
                </View>
                {unlimited ? null : (
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.paper.sunk, overflow: 'hidden' }}>
                    <View style={{ width: `${Math.max(3, Math.round(share * 100))}%`, height: 6, borderRadius: 3, backgroundColor: bar }} />
                  </View>
                )}
              </View>
            );
          })}
        </View>
        {upgradeLabel ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 9, borderRadius: 12, backgroundColor: colors.primary[600] }}>
            <Icon name="shield" size={16} color="#FFFFFF" />
            <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: '#FFFFFF' }}>{upgradeLabel}</Text>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
