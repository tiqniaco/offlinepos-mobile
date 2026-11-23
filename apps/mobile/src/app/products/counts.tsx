import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Screen, Text, Button, EmptyState, Icon, IconBadge, colors, fonts, shadow } from '../../ui';
import { PressableScale } from '../../ui/PressableScale';
import { getDb } from '../../db/client';
import { listCounts, type CountSummary } from '../../domain/inventory/counts';
import { useCan, useCurrency } from '../../features/inventory/useInvCtx';
import { countScope, countTitle, countsListDoc } from '../../features/inventory/countDoc';
import { startCountFlow } from '../../features/inventory/countFlow';
import { ExportBar } from '../../features/common/ExportBar';
import { bizHeader } from '../../features/export/builders';
import { dateTimeLabel, money } from '../../lib/format';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';

const HUE = { DRAFT: 'amber', POSTED: 'leaf', DISCARDED: 'ink' } as const;

/** تقرير الجرد: every count (open, posted, cancelled) with its money impact. */
export default function CountsReport() {
  const { t, i18n } = useTranslation();
  const currency = useCurrency();
  const canCount = useCan('stock.adjust');
  const costView = useCan('cost.view');
  const [rows, setRows] = useState<CountSummary[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      void listCounts(getDb()).then(setRows, (e) => {
        setRows([]);
        toast(errorMessage(t, e), 'error');
      });
    }, [t]),
  );
  const m = (v: number) => money(v, currency, i18n.language);
  return (
    <Screen
      back
      title={t('countReport.title')}
      subtitle={rows?.length ? t('countReport.countsN', { n: rows.length }) : undefined}
      footer={canCount ? <Button testID="counts-new" icon="plus" title={t('countReport.newCount')} onPress={() => void startCountFlow()} /> : undefined}
    >
      {rows && rows.length ? <ExportBar build={async () => countsListDoc(rows, await bizHeader(), costView)} /> : null}
      {rows && rows.length === 0 ? <EmptyState icon="clipboard" hue="sky" title={t('countReport.empty')} body={t('countReport.emptyBody')} /> : null}
      {(rows ?? []).map((c, i) => (
        <Animated.View key={c.id} entering={FadeInDown.delay(Math.min(i, 8) * 30).duration(220)}>
          <PressableScale
            testID={`count-row-${i}`}
            scaleTo={0.98}
            onPress={() => router.push({ pathname: '/products/count-report', params: { id: c.id } })}
            style={[{ padding: 14, gap: 10, borderRadius: 18, backgroundColor: colors.paper.card, borderWidth: c.status === 'DRAFT' ? 1.5 : 0, borderColor: colors.amber[200] }, shadow.soft]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <IconBadge name={c.status === 'DRAFT' ? 'clock' : c.status === 'POSTED' ? 'check' : 'trash'} hue={HUE[c.status]} size={38} />
              <View style={{ flex: 1 }}>
                <Text variant="title" numberOfLines={1}>{countTitle(c)}</Text>
                <Text variant="caption" numberOfLines={1}>
                  {dateTimeLabel(i18n.language, c.postedAt ?? c.updatedAt)}
                  {c.userName ? `  ·  ${c.userName}` : ''}
                  {`  ·  ${countScope(c)}`}
                </Text>
              </View>
              <View style={{ borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: c.status === 'DRAFT' ? colors.amber[50] : c.status === 'POSTED' ? colors.leaf[50] : colors.paper.sunk }}>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 12, lineHeight: 18, color: c.status === 'DRAFT' ? colors.amber[800] : c.status === 'POSTED' ? colors.leaf[700] : colors.ink.soft }}>{t(`countReport.status.${c.status}`)}</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1, gap: 1 }}>
                <Text variant="caption">{t('countReport.items')}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{c.items}</Text>
              </View>
              <View style={{ flex: 1.4, gap: 1 }}>
                <Text variant="caption">{t('countReport.shortTitle', { n: c.shortItems })}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: c.shortageMinor ? colors.rose[700] : colors.ink.soft }}>{costView ? m(c.shortageMinor) : c.shortItems}</Text>
              </View>
              <View style={{ flex: 1.4, gap: 1 }}>
                <Text variant="caption">{t('countReport.surplusTitle', { n: c.surplusItems })}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: c.surplusMinor ? colors.sky[700] : colors.ink.soft }}>{costView ? m(c.surplusMinor) : c.surplusItems}</Text>
              </View>
              <Icon name="chevron" size={18} color={colors.ink.faint} />
            </View>
          </PressableScale>
        </Animated.View>
      ))}
    </Screen>
  );
}
