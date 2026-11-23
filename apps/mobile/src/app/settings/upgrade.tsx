/**
 * Manual upgrade (Egypt): pay by InstaPay or Vodafone Cash to our number, attach the transfer receipt, and the
 * super admin activates the plan within the SLA (12 h). Prices and numbers come from the server (editable there).
 */
import { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { RECEIPT_MAX_BYTES, type ManualBillingInfo } from '@daftarak/shared';
import { Screen, Text, Card, Button, Banner, TextField, SectionTitle, IconBadge, Icon, colors, fonts } from '../../ui';
import { Pressable } from '../../ui/Press';
import { Segmented } from '../../features/common/Segmented';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { useApp } from '../../state/app';
import { fx } from '../../ui/fx';

type Method = 'instapay' | 'vodafone_cash';
const egp = (minor: number) => `${(minor / 100).toLocaleString('en-US')} ج.م`;

export default function Upgrade() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ plan?: string; period?: string }>();
  const business = useApp((s) => s.business);
  const [info, setInfo] = useState<ManualBillingInfo | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [plan, setPlan] = useState(params.plan ?? 'pro');
  const [period, setPeriod] = useState<'monthly' | 'yearly'>(params.period === 'monthly' ? 'monthly' : 'yearly');
  const [method, setMethod] = useState<Method>('instapay');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [receipt, setReceipt] = useState<{ uri: string; base64: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const inFlight = useRef(false);

  const load = () => {
    if (!business?.serverBusinessId) return;
    setLoadErr(null);
    void (async () => {
      try {
        setInfo(await api.billingInfo(await accessToken(), business.serverBusinessId));
      } catch (e) {
        setLoadErr(errorMessage(t, e));
      }
    })();
  };
  useEffect(load, [business?.serverBusinessId]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = info?.plans.find((x) => x.code === plan) ?? info?.plans[0];
  const amount = p ? (period === 'yearly' ? p.yearlyMinor : p.monthlyMinor) : 0;
  const number = info?.methods.find((m) => m.id === method)?.number ?? '';
  const name = (x: { nameAr: string; nameEn: string }) => (i18n.language === 'en' ? x.nameEn : x.nameAr);

  const pick = async (camera: boolean) => {
    setErr(null);
    try {
      if (camera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return setErr(t('upgrade.cameraDenied'));
      }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
      const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (r.canceled || !r.assets[0]) return;
      const a = r.assets[0];
      const width = Math.min(a.width || 1400, 1400);
      const small = await manipulateAsync(a.uri, [{ resize: { width } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
      if (!small.base64) throw new Error('no_base64');
      if ((small.base64.length * 3) / 4 > RECEIPT_MAX_BYTES) return setErr(t('upgrade.tooBig'));
      setReceipt({ uri: small.uri, base64: small.base64 });
    } catch (e) {
      setErr(errorMessage(t, e));
    }
  };

  const digits = phone.replace(/\D/g, '');
  const phoneOk = /^(20)?01[0125]\d{8}$/.test(digits);
  const send = async () => {
    if (inFlight.current || !business || !p) return;
    if (!phoneOk) return setErr(t('upgrade.phoneBad'));
    if (!receipt) return setErr(t('upgrade.needReceipt'));
    inFlight.current = true;
    setSending(true);
    setErr(null);
    try {
      await api.createPaymentRequest(await accessToken(), {
        businessId: business.serverBusinessId,
        plan: p.code,
        period,
        method,
        payerPhone: digits,
        note: note.trim() || undefined,
        receipt: receipt.base64,
      });
      fx.success();
      setDone(true);
    } catch (e) {
      setErr(errorMessage(t, e));
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  if (done) {
    return (
      <Screen back title={t('upgrade.title')} footer={<Button testID="upgrade-done" title={t('upgrade.backToPlans')} onPress={() => router.back()} />}>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
          <IconBadge name="check" hue="leaf" size={72} />
          <Text variant="title" className="text-center">{t('upgrade.sentTitle')}</Text>
          <Text variant="body" className="text-center">{t('upgrade.sentBody', { hours: info?.slaHours ?? 12 })}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      back
      title={t('upgrade.title')}
      subtitle={t('upgrade.subtitle', { hours: info?.slaHours ?? 12 })}
      footer={<Button testID="upgrade-send" icon="upload" title={p ? t('upgrade.send', { amount: egp(amount) }) : t('upgrade.send', { amount: '' })} loading={sending} disabled={!p || sending} onPress={() => void send()} />}
    >
      {loadErr ? <Banner tone="danger" text={loadErr} /> : null}
      {loadErr ? <Button kind="secondary" icon="refresh" title={t('common.retry', { defaultValue: 'جرّب تاني' })} onPress={load} /> : null}
      {!info && !loadErr ? <Text variant="caption" className="text-center">{t('common.loading')}</Text> : null}

      {info ? (
        <>
          <SectionTitle>{t('upgrade.step1')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {info.plans.map((x) => {
              const on = x.code === p?.code;
              return (
                <Pressable key={x.code} testID={`upgrade-plan-${x.code}`} onPress={() => setPlan(x.code)} style={{ flex: 1, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: on ? colors.primary[500] : colors.paper.line, backgroundColor: on ? colors.primary[50] : colors.paper.card, gap: 2 }}>
                  <Text style={{ fontFamily: fonts.bold, fontSize: 14.5, color: on ? colors.primary[700] : colors.ink.DEFAULT }}>{name(x)}</Text>
                  <Text style={{ fontSize: 12.5, color: colors.ink.soft }}>{egp(period === 'yearly' ? x.yearlyMinor : x.monthlyMinor)} / {t(period === 'yearly' ? 'subscription.perYear' : 'subscription.perMonth')}</Text>
                </Pressable>
              );
            })}
          </View>
          <Segmented value={period} onChange={setPeriod} options={[{ value: 'monthly', label: t('subscription.monthly') }, { value: 'yearly', label: t('subscription.yearly') }]} />

          <SectionTitle>{t('upgrade.step2')}</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {info.methods.map((m) => {
              const on = m.id === method;
              return (
                <Pressable key={m.id} testID={`upgrade-method-${m.id}`} onPress={() => setMethod(m.id)} style={{ flex: 1, alignItems: 'center', gap: 6, padding: 12, borderRadius: 14, borderWidth: 2, borderColor: on ? colors.primary[500] : colors.paper.line, backgroundColor: on ? colors.primary[50] : colors.paper.card }}>
                  <IconBadge name={m.id === 'instapay' ? 'card' : 'wallet'} hue={m.id === 'instapay' ? 'primary' : 'rose'} size={38} />
                  <Text style={{ fontFamily: fonts.bold, fontSize: 13.5, color: on ? colors.primary[700] : colors.ink.DEFAULT }}>{t(`upgrade.m.${m.id}`)}</Text>
                </Pressable>
              );
            })}
          </View>
          <Card>
            <Text variant="caption">{t('upgrade.transferTo', { method: t(`upgrade.m.${method}`) })}</Text>
            <Text selectable testID="upgrade-number" style={{ fontFamily: fonts.bold, fontSize: 24, color: colors.ink.DEFAULT, textAlign: 'center', letterSpacing: 1, marginVertical: 6, writingDirection: 'ltr' }}>
              {number}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Icon name="cash" size={16} color={colors.primary[700]} />
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.primary[700] }}>{t('upgrade.amount', { amount: egp(amount) })}</Text>
            </View>
            <Text variant="caption" className="text-center" style={{ marginTop: 4 }}>{t('upgrade.copyHint')}</Text>
          </Card>

          <SectionTitle>{t('upgrade.step3')}</SectionTitle>
          <TextField testID="upgrade-phone" icon="phone" label={t('upgrade.payerPhone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="01x xxxx xxxx" ltr />
          {receipt ? (
            <Card>
              <Image source={{ uri: receipt.uri }} style={{ width: '100%', height: 220, borderRadius: 12, backgroundColor: colors.paper.sunk }} resizeMode="contain" />
              <View style={{ height: 8 }} />
              <Button kind="ghost" icon="refresh" title={t('upgrade.changeReceipt')} onPress={() => void pick(false)} />
            </Card>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button testID="upgrade-gallery" kind="secondary" icon="image" title={t('upgrade.fromGallery')} onPress={() => void pick(false)} />
              </View>
              <View style={{ flex: 1 }}>
                <Button kind="secondary" icon="camera" title={t('upgrade.fromCamera')} onPress={() => void pick(true)} />
              </View>
            </View>
          )}
          <TextField label={t('upgrade.note')} value={note} onChangeText={setNote} maxLength={200} latinDigits={false} />
          <Banner tone="info" icon="clock" text={t('upgrade.sla', { hours: info.slaHours })} />
        </>
      ) : null}
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
