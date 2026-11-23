import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { OFFER_TYPES, type OfferDef, type OfferType } from '@daftarak/shared';
import { Screen, Text, TextField, MoneyField, QtyField, Button, Chip, Banner, Card, Icon, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { deleteOffer, getOffer, saveOffer, toDef, OfferError } from '../../domain/offers/offers';
import { listCategories } from '../../domain/inventory/catalog';
import { listProducts } from '../../domain/inventory/products';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { errorMessage } from '../../lib/errors';
import { parseDayText } from '../../features/common/DateRange';
import { toast } from '../../state/toast';

const toText = (d: number | null | undefined) => (d ? `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}` : '');
const fromText = parseDayText;
/** Non-empty text that isn't a date. */
const badDate = (s: string) => !!s.trim() && fromText(s) == null;

/** One form for every offer type; only the fields of the chosen type are shown. */
export default function OfferForm() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const ctx = useBizCtx();
  const [type, setType] = useState<OfferType>('PERCENT');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pct, setPct] = useState<number | null>(null); // milli-percent via QtyField (10% = 10000)
  const [amount, setAmount] = useState<number | null>(null);
  const [minQty, setMinQty] = useState<number | null>(null);
  const [buy, setBuy] = useState<number | null>(2000);
  const [get, setGet] = useState<number | null>(1000);
  const [tiers, setTiers] = useState<{ minQtyMilli: number; unitPriceMinor: number }[]>([{ minQtyMilli: 6000, unitPriceMinor: 0 }]);
  const [code, setCode] = useState('');
  const [minTotal, setMinTotal] = useState<number | null>(null);
  const [maxUses, setMaxUses] = useState<number | null>(null);
  const [all, setAll] = useState(true);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [catIds, setCatIds] = useState<string[]>([]);
  const [prodIds, setProdIds] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listCategories(getDb()).then(setCats);
    if (!id) return;
    void getOffer(getDb(), id).then(async (r) => {
      if (!r) return;
      const d = toDef(r);
      setType(d.type);
      setName(d.name);
      setActive(d.active);
      setFrom(toText(d.startsDay));
      setTo(toText(d.endsDay));
      setPct(d.valueBp ? d.valueBp * 10 : null);
      setAmount(d.valueMinor ?? null);
      setMinQty(d.minQtyMilli ?? null);
      setBuy(d.buyQtyMilli ?? 2000);
      setGet(d.getQtyMilli ?? 1000);
      if (d.tiers?.length) setTiers(d.tiers);
      setCode(d.couponCode ?? '');
      setMinTotal(d.minTotalMinor ?? null);
      setMaxUses(d.maxUses != null ? d.maxUses * 1000 : null); // QtyField is milli
      setAll(!!d.scope.all);
      setCatIds(d.scope.categoryIds ?? []);
      if (d.scope.productIds?.length) {
        const ps = await listProducts(getDb(), { limit: 500 });
        setProdIds(ps.filter((p) => d.scope.productIds!.includes(p.id)).map((p) => ({ id: p.id, name: p.name })));
      }
    });
  }, [id]);
  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const h = setTimeout(() => void listProducts(getDb(), { search: q, limit: 8 }).then((r) => setHits(r.map((p) => ({ id: p.id, name: p.name })))), 150);
    return () => clearTimeout(h);
  }, [q]);

  const usesPct = type === 'PERCENT' || type === 'BUY_X_GET_Y' || (type === 'COUPON' && !amount);
  const save = async () => {
    if (!ctx) return;
    setErr(null);
    if (badDate(from) || badDate(to)) return setErr(t('offers.errors.bad_date'));
    setBusy(true);
    const def: Omit<OfferDef, 'id' | 'usedCount'> & { id?: string } = {
      id,
      name,
      type,
      active,
      startsDay: fromText(from),
      endsDay: fromText(to),
      scope: type === 'COUPON' || all ? { all: true } : { productIds: prodIds.map((p) => p.id), categoryIds: catIds },
      valueBp: usesPct && pct ? Math.round(pct / 10) : type === 'BUY_X_GET_Y' ? 10_000 : null,
      valueMinor: type === 'FIXED' || (type === 'COUPON' && amount) ? amount : null,
      minQtyMilli: minQty,
      buyQtyMilli: type === 'BUY_X_GET_Y' ? buy : null,
      getQtyMilli: type === 'BUY_X_GET_Y' ? get : null,
      tiers: type === 'QTY_PRICE' ? tiers.filter((x) => x.minQtyMilli > 0 && x.unitPriceMinor > 0) : null,
      couponCode: type === 'COUPON' ? code : null,
      minTotalMinor: type === 'COUPON' ? minTotal : null,
      maxUses: type === 'COUPON' && maxUses ? Math.round(maxUses / 1000) : null,
    };
    try {
      await saveOffer(ctx, def);
      router.back();
    } catch (e) {
      setErr(e instanceof OfferError ? (e.code === 'code_taken' ? t('offers.errors.code_taken') : e.problems.map((p) => t(`offers.errors.${p}`)).join(' · ')) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      back
      title={id ? t('offers.edit') : t('offers.new')}
      right={
        id && ctx ? (
          <Pressable hitSlop={8} onPress={() => Alert.alert(t('offers.delete'), undefined, [{ text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: () => void deleteOffer(ctx, id).then(() => router.back()).catch((e) => toast(errorMessage(t, e), 'error')) }])}>
            <Icon name="trash" size={20} color={colors.rose[600]} />
          </Pressable>
        ) : undefined
      }
      footer={<Button testID="offer-save" title={t('common.save')} loading={busy} onPress={() => void save()} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {OFFER_TYPES.map((x) => (
          <Chip key={x} label={t(`offers.types.${x}`)} selected={type === x} onPress={() => setType(x)} />
        ))}
      </View>
      <Text variant="caption">{t(`offers.help.${type}`)}</Text>
      <TextField testID="offer-name" label={t('offers.name')} value={name} onChangeText={setName} latinDigits={false} placeholder={t('offers.namePh')} />

      {type === 'PERCENT' ? <QtyField label={t('offers.percent')} valueMilli={pct} onValue={setPct} placeholder="10" /> : null}
      {type === 'FIXED' ? <MoneyField label={t('offers.fixedPerUnit')} valueMinor={amount} onValue={setAmount} /> : null}
      {type === 'PERCENT' || type === 'FIXED' ? <QtyField label={t('offers.minQty')} valueMilli={minQty} onValue={setMinQty} placeholder="0" /> : null}
      {type === 'BUY_X_GET_Y' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <QtyField label={t('offers.buy')} valueMilli={buy} onValue={setBuy} />
            </View>
            <View style={{ flex: 1 }}>
              <QtyField label={t('offers.get')} valueMilli={get} onValue={setGet} />
            </View>
          </View>
          <QtyField label={t('offers.getPercent')} valueMilli={pct} onValue={setPct} placeholder="100" hint={t('offers.getPercentHint')} />
        </>
      ) : null}
      {type === 'QTY_PRICE' ? (
        <Card>
          {tiers.map((tier, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end', marginBottom: 6 }}>
              <View style={{ flex: 1 }}>
                <QtyField label={t('offers.fromQty')} valueMilli={tier.minQtyMilli} onValue={(v) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, minQtyMilli: v ?? 0 } : x)))} />
              </View>
              <View style={{ flex: 1 }}>
                <MoneyField label={t('offers.unitPrice')} valueMinor={tier.unitPriceMinor || null} onValue={(v) => setTiers((ts) => ts.map((x, j) => (j === i ? { ...x, unitPriceMinor: v ?? 0 } : x)))} />
              </View>
            </View>
          ))}
          <Button compact kind="ghost" icon="plus" title={t('offers.addTier')} onPress={() => setTiers((ts) => [...ts, { minQtyMilli: 0, unitPriceMinor: 0 }])} />
        </Card>
      ) : null}
      {type === 'COUPON' ? (
        <>
          <TextField testID="offer-code" label={t('offers.couponCode')} value={code} onChangeText={(v) => setCode(v.toUpperCase())} autoCapitalize="characters" ltr placeholder="EID10" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <QtyField label={t('offers.percent')} valueMilli={amount ? null : pct} onValue={(v) => { setPct(v); if (v) setAmount(null); }} />
            </View>
            <View style={{ flex: 1 }}>
              <MoneyField label={t('offers.orAmount')} valueMinor={amount} onValue={(v) => { setAmount(v); if (v) setPct(null); }} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <MoneyField label={t('offers.minTotal')} valueMinor={minTotal} onValue={setMinTotal} />
            </View>
            <View style={{ flex: 1 }}>
              <QtyField label={t('offers.maxUses')} valueMilli={maxUses} onValue={setMaxUses} allowFraction={false} />
            </View>
          </View>
        </>
      ) : null}

      {type !== 'COUPON' ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text variant="subtitle" style={{ flex: 1 }}>{t('offers.allProducts')}</Text>
            <Switch value={all} onValueChange={setAll} trackColor={{ true: colors.primary[500], false: colors.paper.line }} />
          </View>
          {!all ? (
            <View style={{ gap: 8, marginTop: 8 }}>
              <Text variant="label">{t('offers.categories')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {cats.map((c) => (
                  <Chip key={c.id} label={c.name} selected={catIds.includes(c.id)} onPress={() => setCatIds((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))} />
                ))}
              </View>
              <Text variant="label">{t('offers.products')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {prodIds.map((p) => (
                  <Chip key={p.id} label={`${p.name} ✕`} selected onPress={() => setProdIds((x) => x.filter((y) => y.id !== p.id))} />
                ))}
              </View>
              <TextField icon="search" placeholder={t('pos.search')} value={q} onChangeText={setQ} latinDigits={false} />
              {hits.map((h) => (
                <Pressable key={h.id} onPress={() => { setProdIds((x) => (x.some((y) => y.id === h.id) ? x : [...x, h])); setQ(''); }} style={{ paddingVertical: 8 }}>
                  <Text style={{ fontFamily: fonts.medium, fontSize: 14.5, lineHeight: 21, color: colors.primary[700] }}>+ {h.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </Card>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <TextField label={t('offers.from')} value={from} onChangeText={setFrom} ltr placeholder="2026-12-01" keyboardType="numbers-and-punctuation" error={badDate(from) ? t('offers.errors.bad_date') : undefined} />
        </View>
        <View style={{ flex: 1 }}>
          <TextField label={t('offers.to')} value={to} onChangeText={setTo} ltr placeholder="2026-12-31" keyboardType="numbers-and-punctuation" error={badDate(to) ? t('offers.errors.bad_date') : undefined} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text variant="subtitle" style={{ flex: 1 }}>{t('offers.active')}</Text>
        <Switch value={active} onValueChange={setActive} trackColor={{ true: colors.leaf[500], false: colors.paper.line }} />
      </View>
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
