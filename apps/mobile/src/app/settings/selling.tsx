import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Card, Button, Choice, TextField, SectionTitle, Banner, Icon, Chip, QtyField, colors, fonts } from '../../ui';
import { PRICE_ROUNDING_STEPS, markupPrice, pricingOf } from '../../domain/inventory/quickPricing';
import { money } from '../../lib/format';
import { Pressable } from '../../ui/Press';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { changeSetting } from '../../domain/settings/settings';
import { reloadAppData } from '../../state/boot';
import { errorMessage } from '../../lib/errors';
import { toast } from '../../state/toast';

/** Shown the first time (EG): the usual Egyptian wallets. */
export const DEFAULT_WALLETS_EG = ['فودافون كاش', 'إنستاباي', 'اتصالات كاش'];

const MARKUPS = [10, 15, 20, 25, 30, 40, 50];

/**
 * Selling settings: what happens when stock runs out, the wallets / payment apps offered at checkout, and how sale
 * prices are suggested for products added automatically (default markup on cost + rounding).
 */
export default function SellingSettings() {
  const { t, i18n } = useTranslation();
  const user = useApp((s) => s.user)!;
  const markupBp = useApp((s) => s.settings.defaultMarkupBp);
  const roundingMinor = useApp((s) => s.settings.priceRoundingMinor);
  const currency = useApp((s) => s.business?.currency ?? 'EGP');
  const pricing = pricingOf({ defaultMarkupBp: markupBp, priceRoundingMinor: roundingMinor });
  const [customPct, setCustomPct] = useState<number | null>(null);
  const device = useApp((s) => s.device);
  const country = useApp((s) => s.business?.country ?? 'EG');
  const negative = useApp((s) => s.settings.negativeStock ?? 'warn');
  const saved = useApp((s) => s.settings.wallets);
  const [wallets, setWallets] = useState<string[]>(saved ?? (country === 'EG' ? DEFAULT_WALLETS_EG : []));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const ctx = { userId: user.id, deviceId: device?.id ?? '', permissions: user.permissions };

  const setNegative = async (v: 'warn' | 'block') => {
    if (v === negative) return;
    try {
      await changeSetting(getDb(), 'negativeStock', v, ctx);
      await reloadAppData();
      toast(t('common.saved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };

  const setPricing = async <K extends 'defaultMarkupBp' | 'priceRoundingMinor'>(key: K, v: number) => {
    try {
      await changeSetting(getDb(), key, v, ctx);
      await reloadAppData();
      toast(t('common.saved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  const pct = pricing.markupBp / 100;
  const example = markupPrice(1000, pricing);

  const dirty = JSON.stringify(wallets) !== JSON.stringify(saved ?? null);
  const add = () => {
    const w = draft.trim();
    if (!w || wallets.includes(w)) return setDraft('');
    setWallets([...wallets, w]);
    setDraft('');
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= wallets.length) return;
    const next = [...wallets];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setWallets(next);
  };
  const saveWallets = async () => {
    setBusy(true);
    try {
      await changeSetting(getDb(), 'wallets', wallets, ctx);
      await reloadAppData();
      toast(t('common.saved'));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen back title={t('selling.title')} subtitle={t('selling.subtitle')}>
      <SectionTitle>{t('selling.negativeTitle')}</SectionTitle>
      <View style={{ gap: 8 }}>
        <Choice testID="neg-warn" icon="warning" hue="amber" title={t('selling.warn')} hint={t('selling.warnHint')} selected={negative === 'warn'} onPress={() => void setNegative('warn')} />
        <Choice testID="neg-block" icon="lock" hue="rose" title={t('selling.block')} hint={t('selling.blockHint')} selected={negative === 'block'} onPress={() => void setNegative('block')} />
      </View>

      <SectionTitle>{t('selling.pricingTitle')}</SectionTitle>
      <Text variant="caption">{t('selling.pricingHint')}</Text>
      <Card style={{ gap: 10 }}>
        <Text variant="label">{t('selling.markup')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {MARKUPS.map((m) => (
            <Chip key={m} testID={`markup-${m}`} label={`${m}%`} selected={pct === m} onPress={() => void setPricing('defaultMarkupBp', m * 100)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <QtyField label={t('selling.markupCustom')} placeholder={`${pct}`} valueMilli={customPct == null ? null : Math.round(customPct * 1000)} onValue={(v) => setCustomPct(v == null ? null : v / 1000)} />
          </View>
          <Button compact kind="secondary" title={t('common.save')} disabled={customPct == null || customPct > 1000} onPress={() => { if (customPct != null) { void setPricing('defaultMarkupBp', Math.round(customPct * 100)); setCustomPct(null); } }} />
        </View>
        <Text variant="label">{t('selling.rounding')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PRICE_ROUNDING_STEPS.map((r) => (
            <Chip key={r} testID={`rounding-${r}`} label={r === 0 ? t('selling.roundNone') : money(r, currency, i18n.language)} selected={pricing.stepMinor === r} onPress={() => void setPricing('priceRoundingMinor', r)} />
          ))}
        </View>
        {example ? <Text variant="caption">{t('selling.pricingExample', { cost: money(1000, currency, i18n.language), price: money(example, currency, i18n.language), pct })}</Text> : null}
      </Card>

      <SectionTitle>{t('selling.walletsTitle')}</SectionTitle>
      <Text variant="caption">{t('selling.walletsHint')}</Text>
      <Card padded={false}>
        {wallets.length === 0 ? <Text variant="caption" style={{ padding: 14 }}>{t('selling.walletsEmpty')}</Text> : null}
        {wallets.map((w, i) => (
          <View key={w} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.paper.line }}>
            <Icon name="phone" size={18} color={colors.primary[600]} />
            <Text style={{ flex: 1, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.ink.DEFAULT }}>{w}</Text>
            <Pressable accessibilityLabel={t('selling.up')} hitSlop={6} disabled={i === 0} onPress={() => move(i, -1)} style={{ padding: 6, opacity: i === 0 ? 0.3 : 1 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink.soft }}>↑</Text>
            </Pressable>
            <Pressable accessibilityLabel={t('selling.down')} hitSlop={6} disabled={i === wallets.length - 1} onPress={() => move(i, 1)} style={{ padding: 6, opacity: i === wallets.length - 1 ? 0.3 : 1 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink.soft }}>↓</Text>
            </Pressable>
            <Pressable accessibilityLabel={t('common.delete')} hitSlop={6} onPress={() => setWallets(wallets.filter((x) => x !== w))} style={{ padding: 6 }}>
              <Icon name="trash" size={18} color={colors.rose[600]} />
            </Pressable>
          </View>
        ))}
      </Card>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
        <View style={{ flex: 1 }}>
          <TextField label={t('selling.walletName')} placeholder={t('selling.walletPlaceholder')} value={draft} onChangeText={setDraft} latinDigits={false} onSubmitEditing={add} returnKeyType="done" />
        </View>
        <Button compact kind="secondary" icon="plus" title={t('common.add')} disabled={!draft.trim()} onPress={add} />
      </View>
      {saved == null && country === 'EG' ? <Banner tone="info" text={t('selling.walletsDefault')} /> : null}
      <Button icon="check" title={t('common.save')} loading={busy} disabled={busy || (!dirty && saved != null)} onPress={() => void saveWallets()} />
    </Screen>
  );
}
