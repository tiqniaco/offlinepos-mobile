import { useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { applyBp, divRound, normalizeDigits } from '@daftarak/shared';
import { Screen, Text, Button, TextField, Choice, SectionTitle, Chip, Card, Banner } from '../../ui';
import { bulkChangePrices } from '../../domain/inventory/products';
import { useCurrency, useInvCtx } from '../../features/inventory/useInvCtx';
import { invErrorMessage } from '../../features/inventory/errors';
import { money } from '../../lib/format';
import { toast } from '../../state/toast';

const ROUNDS = [0, 25, 50, 100, 500];

/** Bulk price change by percentage with confirmation (SPEC §5). */
export default function BulkEdit() {
  const { t, i18n } = useTranslation();
  const { ids } = useLocalSearchParams<{ ids: string }>();
  const list = (ids ?? '').split(',').filter(Boolean);
  const ctx = useInvCtx();
  const currency = useCurrency();
  const [pct, setPct] = useState('10');
  const [field, setField] = useState<'retail' | 'wholesale' | 'both'>('retail');
  const [round, setRound] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const n = Number(pct.replace(',', '.'));
  const bp = Number.isFinite(n) ? Math.round(n * 100) : NaN;
  const sample = 2250;
  const after = Number.isFinite(bp) ? (round ? divRound(sample + applyBp(sample, bp), round) * round : sample + applyBp(sample, bp)) : sample;

  const apply = () =>
    Alert.alert(t('bulk.title'), t('bulk.confirm', { n: list.length }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.yes'),
        onPress: async () => {
          if (!ctx) return;
          try {
            const c = await bulkChangePrices(ctx, list, { bp, field, roundTo: round || undefined });
            toast(t('bulk.done', { n: c }));
            router.back();
          } catch (e) {
            setErr(invErrorMessage(t, e));
          }
        },
      },
    ]);

  return (
    <Screen back title={t('bulk.title')} subtitle={t('products.selected', { n: list.length })} footer={<Button title={t('bulk.apply', { n: list.length })} disabled={!Number.isFinite(bp) || bp === 0} onPress={apply} />}>
      <TextField label={t('bulk.percent')} hint={t('bulk.percentHint')} value={pct} onChangeText={(v) => setPct(normalizeDigits(v).replace(/[^\d.\-]/g, ''))} keyboardType="numbers-and-punctuation" ltr />
      <SectionTitle>{t('bulk.field')}</SectionTitle>
      <View style={{ gap: 8 }}>
        <Choice compact title={t('productForm.retail')} selected={field === 'retail'} onPress={() => setField('retail')} />
        <Choice compact title={t('productForm.wholesale')} selected={field === 'wholesale'} onPress={() => setField('wholesale')} />
        <Choice compact title={t('bulk.both')} selected={field === 'both'} onPress={() => setField('both')} />
      </View>
      <SectionTitle>{t('bulk.round')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ROUNDS.map((r) => (
          <Chip key={r} label={r ? money(r, currency, i18n.language) : t('bulk.none')} selected={round === r} onPress={() => setRound(r)} />
        ))}
      </View>
      <Card>
        <Text variant="subtitle" style={{ textAlign: 'center' }}>
          {t('bulk.example', { from: money(sample, currency, i18n.language), to: money(after, currency, i18n.language) })}
        </Text>
      </Card>
      {err ? <Banner tone="danger" text={err} /> : null}
    </Screen>
  );
}
