import { useCallback, useState } from 'react';
import { Switch, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { roleHas } from '@daftarak/shared';
import { Screen, Text, Card, Button, MoneyField, TextField, Banner, SectionTitle, IconBadge, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { closeShift, currentShift, listShifts, openShift, shiftSummary, ShiftError, type ShiftSummary } from '../../domain/shifts/shifts';
import { changeSetting } from '../../domain/settings/settings';
import { reloadAppData } from '../../state/boot';
import { hasFeature } from '../../domain/licence/guard';
import { DocRow } from '../../features/common/DocRow';
import { ActionTiles } from '../../features/common/ActionTiles';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { money, dateTimeLabel } from '../../lib/format';
import { errorMessage } from '../../lib/errors';

type Shift = NonNullable<Awaited<ReturnType<typeof currentShift>>>;

/** الوردية: open with a float → sell → close with the counted cash. Expected vs counted, difference recorded. */
export default function Shifts() {
  const { t, i18n } = useTranslation();
  const ctx = useBizCtx();
  const currency = useCurrency();
  const user = useApp((s) => s.user)!;
  const device = useApp((s) => s.device)!;
  const requireShift = useApp((s) => !!s.settings.requireShift);
  const [cur, setCur] = useState<Shift | null>(null);
  const [sum, setSum] = useState<ShiftSummary | null>(null);
  const [history, setHistory] = useState<Shift[]>([]);
  const [float, setFloat] = useState<number | null>(null);
  const [counted, setCounted] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fmt = (v: number) => money(v, currency, i18n.language);

  const load = useCallback(async () => {
    const db = getDb();
    const s = await currentShift(db, device.id);
    setCur(s);
    setSum(s ? await shiftSummary(db, s.id) : null);
    setHistory((await listShifts(db, 30)).filter((x) => x.status === 'CLOSED'));
  }, [device.id]);
  useFocusEffect(useCallback(() => void load(), [load]));

  const run = async (fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setErr(null);
    setBusy(true);
    try {
      const r = await fn();
      after?.(r);
      await load();
    } catch (e) {
      setErr(e instanceof ShiftError ? t(`shift.errors.${e.code}`) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const locked = !hasFeature('expenses_shifts');
  const diff = sum && counted != null ? counted - sum.expectedCashMinor : null;

  return (
    <Screen back title={t('shift.title')}>
      {locked ? (
        <Card style={{ backgroundColor: colors.amber[50] }}>
          <Text style={{ color: colors.amber[700], fontFamily: fonts.semibold, fontSize: 14, lineHeight: 21 }}>{t('licence.feature')}</Text>
          <Button compact kind="secondary" title={t('more.subscription')} onPress={() => router.push('/settings/subscription')} />
        </Card>
      ) : null}
      {!cur ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <IconBadge name="clock" hue="primary" />
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{t('shift.noneOpen')}</Text>
              <Text variant="caption">{t('shift.openHint')}</Text>
            </View>
          </View>
          <MoneyField testID="shift-float" label={t('shift.float')} valueMinor={float} onValue={setFloat} placeholder="0.00" />
          <View style={{ height: 8 }} />
          <Button testID="shift-open" icon="clock" title={t('shift.open')} loading={busy} disabled={locked} onPress={() => ctx && void run(() => openShift(ctx, float ?? 0))} />
        </Card>
      ) : sum ? (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View>
                <Text variant="caption">{t('shift.openSince', { at: dateTimeLabel(i18n.language, cur.openedAt) })}</Text>
                <Text variant="subtitle">{cur.number} · {cur.userName}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="caption">{t('shift.sales')}</Text>
                <Text style={{ fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.ink.DEFAULT }}>{fmt(sum.salesTotalMinor)}</Text>
              </View>
            </View>
            <View style={{ height: 1, backgroundColor: colors.paper.line, marginVertical: 10 }} />
            {[
              [t('shift.float'), sum.openingFloatMinor, 1] as const,
              ...Object.entries(sum.cashIn).map(([k, v]) => [t(`shift.kind.${k}`), v, 1] as const),
              ...Object.entries(sum.cashOut).map(([k, v]) => [t(`shift.kind.${k}`), v, -1] as const),
            ].map(([l, v, sgn], i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                <Text variant="body">{l}</Text>
                <Text style={{ fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20, color: sgn > 0 ? colors.leaf[700] : colors.rose[700] }}>{sgn > 0 ? '+' : '−'}{fmt(v)}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 6, borderTopWidth: 1.5, borderTopColor: colors.ink.DEFAULT }}>
              <Text variant="subtitle">{t('shift.expected')}</Text>
              <Text style={{ fontFamily: fonts.bold, fontSize: 19, lineHeight: 26, color: colors.primary[700] }}>{fmt(sum.expectedCashMinor)}</Text>
            </View>
            {Object.entries(sum.byMethod).filter(([k]) => k !== 'cash').length ? (
              <Text variant="caption" style={{ marginTop: 6 }}>
                {Object.entries(sum.byMethod).filter(([k]) => k !== 'cash').map(([k, v]) => `${t(`pay.methods.${k}`)}: ${fmt(v)}`).join('  ·  ')}
              </Text>
            ) : null}
          </Card>
          <ActionTiles
            columns={3}
            tiles={[
              { key: 'exp', icon: 'wallet', hue: 'rose', label: t('quick.expense'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'EXPENSE' } }) },
              ...(roleHas(user.permissions, 'shift.manage')
                ? [
                    { key: 'in', icon: 'arrowIn' as const, hue: 'leaf' as const, label: t('voucher.title.CASH_IN'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'CASH_IN' } }) },
                    { key: 'out', icon: 'arrowOut' as const, hue: 'amber' as const, label: t('voucher.title.CASH_OUT'), onPress: () => router.push({ pathname: '/vouchers/new', params: { type: 'CASH_OUT' } }) },
                  ]
                : []),
            ]}
          />
          <SectionTitle>{t('shift.closeTitle')}</SectionTitle>
          <Card>
            <MoneyField testID="shift-counted" label={t('shift.counted')} valueMinor={counted} onValue={setCounted} hint={t('shift.countedHint')} />
            {diff != null ? (
              <Text style={{ marginTop: 6, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: diff === 0 ? colors.leaf[700] : diff < 0 ? colors.rose[700] : colors.amber[700] }}>
                {diff === 0 ? t('shift.exact') : diff < 0 ? t('shift.short', { amount: fmt(-diff) }) : t('shift.over', { amount: fmt(diff) })}
              </Text>
            ) : null}
            <View style={{ height: 8 }} />
            <TextField label={t('voucher.note')} value={note} onChangeText={setNote} latinDigits={false} />
            <View style={{ height: 8 }} />
            <Button testID="shift-close" kind="danger" icon="lock" title={t('shift.close')} loading={busy} disabled={counted == null} onPress={() => ctx && void run(() => closeShift(ctx, counted ?? 0, note), () => { setCounted(null); setNote(''); router.push({ pathname: '/shifts/[id]', params: { id: cur.id } }); })} />
          </Card>
        </>
      ) : null}
      {err ? <Banner tone="danger" text={err} /> : null}

      {roleHas(user.permissions, 'settings.manage') ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text variant="subtitle">{t('shift.require')}</Text>
              <Text variant="caption">{t('shift.requireHint')}</Text>
            </View>
            <Switch
              value={requireShift}
              onValueChange={(v) => void changeSetting(getDb(), 'requireShift', v, { userId: user.id, deviceId: device.id }).then(reloadAppData)}
              trackColor={{ true: colors.primary[500], false: colors.paper.line }}
            />
          </View>
        </Card>
      ) : null}

      {history.length ? <SectionTitle>{t('shift.history')}</SectionTitle> : null}
      {history.map((s) => (
        <DocRow
          key={s.id}
          icon="clock"
          hue="primary"
          title={`${s.number} · ${s.userName}`}
          subtitle={dateTimeLabel(i18n.language, s.closedAt ?? s.openedAt)}
          amount={fmt(s.countedCashMinor ?? 0)}
          tag={s.differenceMinor ? (s.differenceMinor < 0 ? t('shift.shortTag', { amount: fmt(-s.differenceMinor) }) : t('shift.overTag', { amount: fmt(s.differenceMinor) })) : t('shift.exact')}
          tagColor={s.differenceMinor ? (s.differenceMinor < 0 ? colors.rose[700] : colors.amber[700]) : colors.leaf[700]}
          onPress={() => router.push({ pathname: '/shifts/[id]', params: { id: s.id } })}
        />
      ))}
    </Screen>
  );
}
