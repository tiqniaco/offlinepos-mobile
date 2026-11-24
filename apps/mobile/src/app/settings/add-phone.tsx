/**
 * «ضيف موبايل كاشير»: shows a one-time QR (15 minutes) for a new phone to join this shop. The QR carries the join code
 * and the shop's sync key (phone to phone only). The catalog is uploaded first, so the new phone has data at once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { joinQr } from '@daftarak/shared';
import { Screen, Card, Text, Button, Banner, colors, fonts } from '../../ui';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { useApp } from '../../state/app';
import { qrSvg } from '../../features/printing/qr';
import { ensureSyncKey, noteCashiers, runSync } from '../../features/sync/engine';
import { NoScreenshots } from '../../features/NoScreenshots';
import { fx } from '../../ui/fx';

export default function AddPhone() {
  const { t } = useTranslation();
  const businessId = useApp((s) => s.business?.serverBusinessId);
  const deviceId = useApp((s) => s.device?.id);
  const [qr, setQr] = useState<{ svg: string; expiresAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [left, setLeft] = useState(0);
  const before = useRef<number | null>(null);

  const make = useCallback(async () => {
    if (!businessId || !deviceId) return;
    setErr(null);
    setQr(null);
    try {
      const key = await ensureSyncKey();
      const tk = await accessToken();
      before.current = (await api.shopDevices(tk, businessId)).devices.filter((d) => d.role === 'cashier').length;
      // The new phone downloads the catalog right after joining: make sure it is there and current.
      await runSync(true);
      const inv = await api.syncInvite(tk, businessId, deviceId);
      setQr({ svg: qrSvg(joinQr(inv.code, key)), expiresAt: inv.expiresAt });
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  }, [businessId, deviceId, t]);

  useEffect(() => {
    void make();
  }, [make]);

  // Countdown + watch for the new phone.
  useEffect(() => {
    if (!qr || joined || !businessId) return;
    const tick = setInterval(() => setLeft(Math.max(0, Math.round((qr.expiresAt - Date.now()) / 1000))), 1000);
    const poll = setInterval(() => {
      void accessToken()
        .then((tk) => api.shopDevices(tk, businessId))
        .then(async (r) => {
          const n = r.devices.filter((d) => d.role === 'cashier').length;
          if (before.current != null && n > before.current) {
            setJoined(true);
            fx.success();
            await noteCashiers(n);
          }
        })
        .catch(() => undefined);
    }, 4000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [qr, joined, businessId]);

  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <Screen back title={t('addPhone.title')} subtitle={t('addPhone.subtitle')}>
      <NoScreenshots id="add-phone" />
      {err ? <Banner tone="danger" text={err} action={t('common.retry')} onAction={() => void make()} /> : null}
      {joined ? (
        <Card>
          <Text style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 28, color: colors.leaf[700], textAlign: 'center' }}>{t('addPhone.joined')}</Text>
          <Text variant="caption" style={{ textAlign: 'center', marginTop: 4 }}>{t('addPhone.joinedHint')}</Text>
          <Button title={t('common.done')} onPress={() => router.back()} />
        </Card>
      ) : qr ? (
        <Card>
          <View style={{ alignItems: 'center', gap: 10 }}>
            <View testID="add-phone-qr" style={{ padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF' }}>
              <SvgXml xml={qr.svg} width={250} height={250} />
            </View>
            {left > 0 ? (
              <Text style={{ fontSize: 13, lineHeight: 21, color: colors.ink.soft }}>{t('addPhone.expires', { time: mm })}</Text>
            ) : (
              <Button kind="secondary" icon="refresh" title={t('addPhone.newCode')} onPress={() => void make()} />
            )}
          </View>
        </Card>
      ) : !err ? (
        <Banner tone="info" text={t('common.loading')} />
      ) : null}
      <Card>
        <View style={{ gap: 8 }}>
          {[1, 2, 3].map((n) => (
            <View key={n} style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary[100] }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 12, lineHeight: 19, color: colors.primary[700] }}>{n}</Text>
              </View>
              <Text style={{ flex: 1, fontSize: 13.5, lineHeight: 22, color: colors.ink.DEFAULT }}>{t(`addPhone.step${n}`)}</Text>
            </View>
          ))}
        </View>
      </Card>
      <Banner tone="warn" icon="lock" text={t('addPhone.secret')} />
    </Screen>
  );
}
