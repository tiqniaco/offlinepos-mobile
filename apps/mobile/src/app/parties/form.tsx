import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, TextField, MoneyField, Button, Chip, Banner, Text, Card, colors } from '../../ui';
import { getDb } from '../../db/client';
import { getParty, saveParty, PartyError } from '../../domain/parties/parties';
import { createPartyWithOpening, VoucherError } from '../../domain/vouchers/vouchers';
import { useLastParty } from '../../state/lastParty';
import { useBizCtx } from '../../features/sales/useSalesCtx';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

/** Minimal form (name, mobile, address) + "more" (SPEC §5). New parties can start with an opening balance. */
export default function PartyForm() {
  const { t } = useTranslation();
  const { type: tp, id, name: preName, returnTo } = useLocalSearchParams<{ type?: string; id?: string; name?: string; returnTo?: string }>();
  const type: 'C' | 'S' = tp === 'S' ? 'S' : 'C';
  const ctx = useBizCtx();
  const [name, setName] = useState(preName ?? '');
  const [mobile, setMobile] = useState('');
  const [address, setAddress] = useState('');
  const [more, setMore] = useState(false);
  const [email, setEmail] = useState('');
  const [taxNumber, setTaxNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [limit, setLimit] = useState<number | null>(null);
  const [wholesale, setWholesale] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  const [openingSide, setOpeningSide] = useState<1 | -1>(1);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    void getParty(getDb(), type, id).then((p) => {
      if (!p) return;
      setName(p.name);
      setMobile(p.mobile ?? '');
      setAddress(p.address ?? '');
      setEmail(p.email ?? '');
      setTaxNumber(p.taxNumber ?? '');
      setNotes(p.notes ?? '');
      setLimit(p.creditLimitMinor ?? null);
      setWholesale(p.priceTier === 'wholesale');
      if (p.email || p.taxNumber || p.notes || p.creditLimitMinor) setMore(true);
    });
  }, [id, type]);

  const save = async () => {
    if (!ctx) return;
    setErr(null);
    setBusy(true);
    try {
      const input = { id, name, mobile, address, email, taxNumber, notes, creditLimitMinor: limit, priceTier: wholesale ? ('wholesale' as const) : ('retail' as const) };
      // New party + opening balance in one transaction: a failure leaves nothing behind, so retrying is safe.
      const pid = id ? await saveParty(ctx, type, input) : await createPartyWithOpening(ctx, type, input, opening ? { amountMinor: opening, sign: openingSide } : null);
      toast(t('common.saved'));
      if (id) router.back();
      else if (returnTo === 'pick') {
        const p = await getParty(getDb(), type, pid);
        if (p) useLastParty.getState().put(type, { id: p.id, name: p.name, mobile: p.mobile, address: p.address, priceTier: p.priceTier === 'wholesale' ? 'wholesale' : 'retail', creditLimitMinor: p.creditLimitMinor ?? null, balanceMinor: p.balanceMinor, lastActivityAt: p.lastActivityAt });
        router.back();
      } else router.replace({ pathname: '/parties/[id]', params: { id: pid, type } });
    } catch (e) {
      setErr(e instanceof PartyError ? t(`parties.errors.${e.code}`) : e instanceof VoucherError ? t(`voucher.errors.${e.code}`) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={id ? t('parties.edit') : t(type === 'C' ? 'parties.newC' : 'parties.newS')} footer={<Button testID="party-save" title={t('common.save')} loading={busy} disabled={!name.trim()} onPress={() => void save()} />}>
      <TextField testID="party-name" label={t('parties.name')} value={name} onChangeText={setName} latinDigits={false} autoFocus={!id} />
      <TextField testID="party-mobile" label={t('parties.mobile')} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" ltr hint={t('parties.mobileHint')} />
      <TextField label={t('parties.address')} value={address} onChangeText={setAddress} latinDigits={false} />
      {!id ? (
        <Card>
          <View style={{ gap: 8 }}>
            <Text variant="subtitle">{t('parties.openingTitle')}</Text>
            <MoneyField valueMinor={opening} onValue={setOpening} placeholder="0.00" />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Chip label={t(type === 'C' ? 'parties.openingOwesUs' : 'parties.openingWeOwe')} selected={openingSide === 1} onPress={() => setOpeningSide(1)} />
              <Chip label={t(type === 'C' ? 'parties.openingWeOweC' : 'parties.openingOwesUsS')} selected={openingSide === -1} onPress={() => setOpeningSide(-1)} />
            </View>
          </View>
        </Card>
      ) : null}
      <Button kind="ghost" icon={more ? 'minus' : 'plus'} title={t('parties.more')} onPress={() => setMore((v) => !v)} />
      {more ? (
        <View style={{ gap: 12 }}>
          {type === 'C' ? (
            <>
              <MoneyField label={t('parties.creditLimit')} valueMinor={limit} onValue={setLimit} hint={t('parties.creditLimitHint')} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip label={t('customer.retail')} selected={!wholesale} onPress={() => setWholesale(false)} />
                <Chip label={t('customer.wholesale')} selected={wholesale} onPress={() => setWholesale(true)} />
              </View>
            </>
          ) : null}
          <TextField label={t('parties.taxNumber')} value={taxNumber} onChangeText={setTaxNumber} ltr />
          <TextField label={t('parties.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" ltr />
          <TextField label={t('parties.notes')} value={notes} onChangeText={setNotes} latinDigits={false} multiline style={{ height: 80 }} />
        </View>
      ) : null}
      {err ? <Banner tone="danger" text={err} /> : null}
      <View style={{ height: 4, backgroundColor: colors.paper.DEFAULT }} />
    </Screen>
  );
}
