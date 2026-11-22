import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { businessDay, formatMinor, offerLive } from '@daftarak/shared';
import { Screen, Text, EmptyState, Fab, Card, IconBadge, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { listOffers, saveOffer, toDef } from '../../domain/offers/offers';
import { hasFeature } from '../../domain/licence/guard';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { dayText } from '../../features/export/builders';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

type Row = Awaited<ReturnType<typeof listOffers>>[number];

/** Offers & coupons: what's running today, one switch to stop an offer. */
export default function Offers() {
  const { t } = useTranslation();
  const ctx = useBizCtx();
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const today = businessDay(Date.now(), tz);
  const [rows, setRows] = useState<Row[]>([]);
  const load = useCallback(() => void listOffers(getDb()).then(setRows), []);
  useFocusEffect(load);
  const locked = !hasFeature('offers');

  const summary = (r: Row) => {
    const d = toDef(r);
    switch (d.type) {
      case 'PERCENT':
        return t('offers.sumPercent', { v: (d.valueBp ?? 0) / 100 });
      case 'FIXED':
        return t('offers.sumFixed', { v: formatMinor(d.valueMinor ?? 0) });
      case 'BUY_X_GET_Y':
        return t('offers.sumBxgy', { x: (d.buyQtyMilli ?? 0) / 1000, y: (d.getQtyMilli ?? 0) / 1000 });
      case 'QTY_PRICE':
        return t('offers.sumQty', { n: d.tiers?.length ?? 0 });
      default:
        return `${d.couponCode} · ${d.valueBp ? `${d.valueBp / 100}%` : formatMinor(d.valueMinor ?? 0)}`;
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen back title={t('offers.title')} subtitle={t('offers.subtitle')}>
        {locked ? (
          <Card style={{ backgroundColor: colors.amber[50] }}>
            <Text style={{ color: colors.amber[700], fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 }}>{t('licence.feature')}</Text>
          </Card>
        ) : null}
        {rows.length === 0 ? <EmptyState icon="tag" hue="leaf" title={t('offers.empty')} body={t('offers.emptyBody')} /> : null}
        {rows.map((r) => {
          const live = offerLive(toDef(r), today);
          const state = !r.active ? t('offers.stopped') : r.endsDay && today > r.endsDay ? t('offers.ended') : r.startsDay && today < r.startsDay ? t('offers.upcoming') : t('offers.running');
          return (
            <Card key={r.id} onPress={() => router.push({ pathname: '/offers/form', params: { id: r.id } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <IconBadge name={r.type === 'COUPON' ? 'receipt' : 'tag'} hue={live ? 'leaf' : 'ink'} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.ink.DEFAULT }}>{r.name}</Text>
                  <Text variant="caption">
                    {t(`offers.types.${r.type}`)} · {summary(r)}
                  </Text>
                  <Text variant="caption" style={{ color: live ? colors.leaf[700] : colors.ink.mute }}>
                    {state}
                    {r.startsDay || r.endsDay ? `  ·  ${r.startsDay ? dayText(r.startsDay) : '…'} → ${r.endsDay ? dayText(r.endsDay) : '…'}` : ''}
                  </Text>
                </View>
                <Switch
                  value={r.active}
                  disabled={locked}
                  onValueChange={(v) => ctx && void saveOffer(ctx, { ...toDef(r), active: v }).then(load, (e) => toast(errorMessage(t, e), 'error'))}
                  trackColor={{ true: colors.leaf[500], false: colors.paper.line }}
                />
              </View>
            </Card>
          );
        })}
        <View style={{ height: 70 }} />
      </Screen>
      {!locked ? <Fab testID="offer-add" onPress={() => router.push('/offers/form')} /> : null}
    </View>
  );
}
