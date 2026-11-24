/**
 * «موبايلات المحل»: the shop's phone (main) and the owner's follower phones («موبايل متابعة»), against the plan limit.
 * Followers can be stopped from here. How to add one is explained step by step.
 */
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { ShopDevicesResponse } from '@daftarak/shared';
import { Screen, Card, Text, Button, Banner, IconBadge, colors, fonts } from '../../ui';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { dateTimeLabel } from '../../lib/format';
import { useApp } from '../../state/app';
import { noteFollowers, pushSnapshot } from '../../features/follow/push';
import { useUpgrade } from '../../state/upgrade';
import { noteCashiers, useSync } from '../../features/sync/engine';

type D = ShopDevicesResponse['devices'][number];

export default function Devices() {
  const { t, i18n } = useTranslation();
  const businessId = useApp((s) => s.business?.serverBusinessId);
  const [res, setRes] = useState<ShopDevicesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const failed = useSync((s) => s.failed);

  const load = useCallback(() => {
    if (!businessId) return;
    void accessToken()
      .then((tk) => api.shopDevices(tk, businessId))
      .then(
        (r) => {
          setRes(r);
          setErr(null);
          const n = r.devices.filter((d) => d.role === 'follower').length;
          void noteFollowers(n).then(() => (n ? pushSnapshot() : undefined));
          void noteCashiers(r.devices.filter((d) => d.role === 'cashier').length);
        },
        (e) => setErr(errorMessage(t, e)),
      );
  }, [businessId, t]);
  useFocusEffect(load);

  const stop = (d: D) =>
    Alert.alert(t('devices.stop'), t('devices.stopConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('devices.stop'),
        style: 'destructive',
        onPress: () => void accessToken().then((tk) => api.stopDevice(tk, businessId!, d.id)).then(load, (e) => setErr(errorMessage(t, e))),
      },
    ]);

  const used = res?.devices.length ?? 0;
  const limit = res?.limit ?? 1;
  const full = limit >= 0 && used >= limit;
  return (
    <Screen back title={t('devices.title')} subtitle={t('devices.subtitle')}>
      {err ? <Banner tone="danger" text={err} /> : null}
      {res ? (
        <Card>
          <Text variant="caption">{t('devices.usage')}</Text>
          <Text testID="devices-usage" style={{ fontFamily: fonts.bold, fontSize: 20, lineHeight: 32, color: full ? colors.rose[700] : colors.ink.DEFAULT }}>
            {limit < 0 ? t('devices.usedUnlimited', { used }) : t('devices.used', { used, limit })}
          </Text>
          {full ? (
            <Button compact kind="secondary" icon="shield" title={t('devices.upgrade')} onPress={() => useUpgrade.getState().show('devices')} />
          ) : null}
        </Card>
      ) : null}
      {res?.devices.map((d) => (
        <Card key={d.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconBadge name={d.role === 'main' ? 'store' : d.role === 'cashier' ? 'cart' : 'eye'} hue={d.role === 'main' ? 'leaf' : 'primary'} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 23, color: colors.ink.DEFAULT }}>
                {d.role === 'main' ? t('devices.main') : d.role === 'cashier' ? t('devices.cashier') : t('devices.follower')} · {d.model ?? (d.platform === 'ios' ? 'iPhone' : 'Android')}
                {d.current ? ` · ${t('sessions.thisPhone')}` : ''}
              </Text>
              <Text variant="caption">{d.lastSeenAt ? t('devices.lastSeen', { at: dateTimeLabel(i18n.language, d.lastSeenAt) }) : t('devices.since', { at: dateTimeLabel(i18n.language, d.activatedAt) })}</Text>
            </View>
            {d.role !== 'main' ? <Button compact kind="danger" title={t('devices.stop')} onPress={() => stop(d)} /> : null}
          </View>
        </Card>
      ))}
      {!full && res ? <Button testID="devices-add" icon="plus" title={t('devices.add')} onPress={() => router.push('/settings/add-phone')} /> : null}
      {failed ? <Banner tone="warn" text={t('devices.failed', { n: failed })} /> : null}
      <Banner tone="info" icon="info" text={t('devices.addHint')} />
    </Screen>
  );
}
