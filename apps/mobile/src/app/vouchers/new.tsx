import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { PaymentMethod } from '@daftarak/shared';
import { Screen, Text, MoneyField, Button, Chip, Banner, TextField, Avatar, Icon, colors, fonts, shadow } from '../../ui';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { getParty, owed, type PartyRow } from '../../domain/parties/parties';
import { listExpenseCategories, postVoucher, VoucherError, type VoucherType } from '../../domain/vouchers/vouchers';
import { ShiftError } from '../../domain/shifts/shifts';
import { MethodCard } from '../../features/sales/sheets';
import { PartyPicker } from '../../features/parties/PartyPicker';
import { balanceLabel, partyColor } from '../../features/parties/format';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { errorMessage } from '../../lib/errors';
import { money } from '../../lib/format';

const PARTY_OF: Partial<Record<VoucherType, 'C' | 'S'>> = { RECEIPT: 'C', CUSTOMER_REFUND: 'C', PAYMENT: 'S', SUPPLIER_REFUND: 'S' };
const METHODS: { m: PaymentMethod; icon: 'cash' | 'card' | 'phone' | 'book' }[] = [
  { m: 'cash', icon: 'cash' },
  { m: 'wallet', icon: 'phone' },
  { m: 'card', icon: 'card' },
  { m: 'bank', icon: 'book' },
];

/** One form for every money movement: amount → method → (party / category) → save. 3 taps for the common case. */
export default function NewVoucher() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ type?: VoucherType; partyId?: string; amount?: string }>();
  const type: VoucherType = params.type ?? 'RECEIPT';
  const partyType = PARTY_OF[type] ?? null;
  const ctx = useBizCtx();
  const currency = useCurrency();
  const wallets = useApp((s) => s.settings.wallets ?? []);
  const [party, setParty] = useState<{ id: string; name: string; balanceMinor: number } | null>(null);
  const [pick, setPick] = useState(false);
  const [amount, setAmount] = useState<number | null>(params.amount ? Number(params.amount) : null);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [label, setLabel] = useState<string | null>(null);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [cat, setCat] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.partyId && partyType) void getParty(getDb(), partyType, params.partyId).then((p) => p && setParty({ id: p.id, name: p.name, balanceMinor: p.balanceMinor }));
    if (type === 'EXPENSE') void listExpenseCategories(getDb()).then((c) => setCats(c));
  }, [params.partyId, partyType, type]);

  const o = party && partyType ? owed(partyType, party.balanceMinor) : 0;
  const cashOnly = type === 'CASH_IN' || type === 'CASH_OUT';

  const save = async () => {
    if (!ctx || !amount) return;
    setErr(null);
    setBusy(true);
    try {
      const r = await postVoucher(ctx, { type, amountMinor: amount, method: cashOnly ? 'cash' : method, label, partyId: party?.id ?? null, categoryId: cat, note });
      router.replace({ pathname: '/vouchers/[id]', params: { id: r.id, fresh: '1' } });
    } catch (e) {
      setErr(e instanceof VoucherError ? t(`voucher.errors.${e.code}`) : e instanceof ShiftError ? t(`shift.errors.${e.code}`) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t(`voucher.title.${type}`)} footer={<Button testID="voucher-save" title={t('voucher.save')} loading={busy} disabled={!amount || (!!partyType && !party) || (type === 'EXPENSE' && !cat)} onPress={() => void save()} />}>
      {partyType ? (
        <Pressable testID="voucher-party" onPress={() => setPick(true)} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, backgroundColor: colors.paper.card, opacity: pressed ? 0.85 : 1 }, shadow.soft]}>
          {party ? <Avatar name={party.name} color={partyColor(party.id)} size={40} /> : <Icon name="users" color={colors.ink.mute} />}
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: party ? colors.ink.DEFAULT : colors.ink.mute }}>{party?.name ?? t(partyType === 'C' ? 'parties.pickC' : 'parties.pickS')}</Text>
            {party ? <Text style={{ fontFamily: fonts.medium, fontSize: 13, lineHeight: 19, color: balanceLabel(partyType, o, currency, i18n.language).color }}>{o ? `${balanceLabel(partyType, o, currency, i18n.language).tag} ${money(Math.abs(o), currency, i18n.language)}` : t('parties.settled')}</Text> : null}
          </View>
          <Icon name="chevron" size={16} color={colors.ink.faint} />
        </Pressable>
      ) : null}

      <MoneyField testID="voucher-amount" label={t('voucher.amount')} valueMinor={amount} onValue={setAmount} autoFocus={!partyType || !!params.partyId} />
      {party && o > 0 && (type === 'RECEIPT' || type === 'PAYMENT') ? (
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Chip label={t('voucher.payAll', { amount: money(o, currency, i18n.language) })} selected={amount === o} onPress={() => setAmount(o)} />
          <Chip label={t('voucher.half')} selected={amount === Math.round(o / 2)} onPress={() => setAmount(Math.round(o / 2))} />
        </View>
      ) : null}

      {type === 'EXPENSE' ? (
        <View style={{ gap: 6 }}>
          <Text variant="label">{t('expenses.category')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {cats.map((c) => (
              <Chip key={c.id} label={c.name} selected={cat === c.id} onPress={() => setCat(c.id)} />
            ))}
            <Chip label={`+ ${t('expenses.manageCats')}`} onPress={() => router.push('/expenses/categories')} />
          </View>
        </View>
      ) : null}

      {!cashOnly ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {METHODS.map((x) => (
              <MethodCard key={x.m} label={t(`pay.methods.${x.m}`)} icon={x.icon === 'cash' ? 'layers' : x.icon} selected={method === x.m} onPress={() => { setMethod(x.m); setLabel(x.m === 'wallet' ? (wallets[0] ?? null) : null); }} />
            ))}
          </View>
          {method === 'wallet' && wallets.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {wallets.map((w) => (
                <Chip key={w} label={w} selected={label === w} onPress={() => setLabel(w)} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      <TextField label={t('voucher.note')} value={note} onChangeText={setNote} latinDigits={false} placeholder={t('voucher.notePh')} />
      {err ? <Banner tone="danger" text={err} /> : null}
      {partyType ? (
        <PartyPicker
          visible={pick}
          type={partyType}
          currency={currency}
          lang={i18n.language}
          onClose={() => setPick(false)}
          onPick={(p: PartyRow) => {
            setParty({ id: p.id, name: p.name, balanceMinor: p.balanceMinor });
            setPick(false);
          }}
        />
      ) : null}
    </Screen>
  );
}
