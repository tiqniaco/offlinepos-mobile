import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { useTranslation } from 'react-i18next';
import type { Discount } from '@daftarak/shared';
import { Sheet, Text, Button, QtyField, MoneyField, TextField, Chip, ListGroup, ListRow, Icon, Avatar, Banner, colors, fonts } from '../../ui';
import type { CartLine } from '../../domain/sales/sales';
import { createCustomer, searchCustomers } from '../../domain/parties/customers';
import { getDb } from '../../db/client';
import { money } from '../../lib/format';
import type { PartyCtx } from '../../domain/parties/customers';
import { toast } from '../../state/toast';
import { errorMessage } from '../../lib/errors';

/** Drop empty discounts and cap an amount discount at what it applies to. */
function cleanDiscount(d: Discount | null, base: number): Discount | null {
  if (!d) return null;
  if (d.type === 'percent') return d.bp > 0 ? d : null;
  const minor = Math.min(d.minor, Math.max(0, base));
  return minor > 0 ? { type: 'amount', minor } : null;
}

function DiscountEditor({ value, onChange, base, currency, lang }: { value: Discount | null; onChange: (d: Discount | null) => void; base: number; currency: 'EGP' | 'SAR'; lang: string }) {
  const { t } = useTranslation();
  const type = value?.type ?? 'percent';
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Chip label={t('line.percent')} selected={type === 'percent'} onPress={() => onChange({ type: 'percent', bp: value?.type === 'percent' ? value.bp : 0 })} />
        <Chip label={t('line.amount')} selected={type === 'amount'} onPress={() => onChange({ type: 'amount', minor: value?.type === 'amount' ? value.minor : 0 })} />
        {[5, 10, 15].map((p) => (
          <Chip key={p} label={`${p}%`} selected={value?.type === 'percent' && value.bp === p * 100} onPress={() => onChange({ type: 'percent', bp: p * 100 })} />
        ))}
      </View>
      {type === 'percent' ? (
        <QtyField label={t('line.percent')} valueMilli={value?.type === 'percent' ? value.bp * 10 : null} onValue={(v) => onChange(v ? { type: 'percent', bp: Math.min(10_000, Math.round(v / 10)) } : null)} />
      ) : (
        <MoneyField label={t('line.amount')} valueMinor={value?.type === 'amount' ? value.minor : null} onValue={(v) => onChange(v ? { type: 'amount', minor: Math.min(v, base) } : null)} hint={money(base, currency, lang)} />
      )}
    </View>
  );
}

export function LineSheet({ line, offerMinor = 0, canChangePrice, currency, lang, onClose, onSave, onRemove }: { line: CartLine | null; /** Automatic offer already taken off this line. */ offerMinor?: number; canChangePrice: boolean; currency: 'EGP' | 'SAR'; lang: string; onClose: () => void; onSave: (patch: Partial<CartLine>) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [disc, setDisc] = useState<Discount | null>(null);
  useEffect(() => {
    if (line) {
      setQ(line.qtyMilli);
      setPrice(line.unitPriceMinor);
      setDisc(line.discount ?? null);
    }
  }, [line]);
  if (!line) return null;
  const gross = Math.round(((price ?? 0) * (q ?? 0)) / 1000);
  // The manual discount applies after the automatic offer, so it can't exceed what's left.
  const base = Math.max(0, gross - offerMinor);
  return (
    <Sheet
      visible
      onClose={onClose}
      title={line.name}
      footer={
        <>
          <Button title={t('line.done')} disabled={!q || q <= 0} onPress={() => onSave({ qtyMilli: q ?? 0, unitPriceMinor: price ?? line.unitPriceMinor, discount: cleanDiscount(disc, base) })} />
          <Button kind="danger" icon="trash" title={t('line.remove')} onPress={onRemove} />
        </>
      }
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <QtyField label={`${t('line.qty')} (${line.unitName})`} valueMilli={q} onValue={setQ} autoFocus />
        </View>
        <View style={{ flex: 1 }}>
          <MoneyField label={t('line.price')} valueMinor={price} onValue={setPrice} editable={canChangePrice} hint={canChangePrice ? undefined : t('line.priceLocked')} />
        </View>
      </View>
      <Text variant="label">{t('line.discount')}</Text>
      <DiscountEditor value={disc} onChange={setDisc} base={base} currency={currency} lang={lang} />
    </Sheet>
  );
}

export function InvoiceDiscountSheet({ visible, value, base, currency, lang, onClose, onSave }: { visible: boolean; value: Discount | null; base: number; currency: 'EGP' | 'SAR'; lang: string; onClose: () => void; onSave: (d: Discount | null) => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState<Discount | null>(value);
  useEffect(() => setD(value), [value, visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title={t('pos.invoiceDiscount')} footer={<Button title={t('line.done')} onPress={() => onSave(cleanDiscount(d, base))} />}>
      <DiscountEditor value={d} onChange={setD} base={base} currency={currency} lang={lang} />
    </Sheet>
  );
}

export function CustomerSheet({ visible, ctx, canAdd, currency, lang, onClose, onPick }: { visible: boolean; ctx: PartyCtx | null; /** parties.manage — creating a customer needs it. */ canAdd: boolean; currency: 'EGP' | 'SAR'; lang: string; onClose: () => void; onPick: (c: { id: string; name: string; priceTier: 'retail' | 'wholesale' } | null) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof searchCustomers>>>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [wholesale, setWholesale] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const h = setTimeout(() => void searchCustomers(getDb(), q).then(setRows), 150);
    return () => clearTimeout(h);
  }, [q, visible]);
  const save = async () => {
    if (!name.trim()) return;
    if (!ctx) return toast(t('customer.unavailable'), 'error');
    try {
      const id = await createCustomer(ctx, { name, mobile, priceTier: wholesale ? 'wholesale' : 'retail' });
      onPick({ id, name: name.trim(), priceTier: wholesale ? 'wholesale' : 'retail' });
      setAdding(false);
      setName('');
      setMobile('');
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('customer.title')} footer={adding ? <Button title={t('common.save')} disabled={!ctx || !name.trim()} onPress={save} /> : canAdd ? <Button kind="secondary" icon="plus" title={t('customer.add')} onPress={() => { setAdding(true); setName(q); }} /> : undefined}>
      {adding ? (
        <>
          {!ctx ? <Banner tone="danger" text={t('customer.unavailable')} /> : null}
          <TextField label={t('customer.name')} value={name} onChangeText={setName} latinDigits={false} autoFocus />
          <TextField label={t('customer.mobile')} value={mobile} onChangeText={setMobile} keyboardType="phone-pad" ltr />
          <Chip label={t('customer.wholesale')} selected={wholesale} onPress={() => setWholesale((v) => !v)} />
        </>
      ) : (
        <>
          <TextField icon="search" placeholder={t('customer.search')} value={q} onChangeText={setQ} latinDigits={false} autoFocus />
          <ListGroup>
            <ListRow icon="users" hue="ink" title={t('customer.none')} onPress={() => onPick(null)} />
            {rows.map((c, i) => (
              <ListRow
                key={c.id}
                leading={<Avatar name={c.name} color={colors.primary[500]} size={40} />}
                title={c.name}
                subtitle={[c.mobile ? `+${c.mobile}` : null, Number(c.balanceMinor) ? t('pos.customerBalance', { amount: money(Number(c.balanceMinor), currency, lang) }) : null].filter(Boolean).join('  ·  ') || undefined}
                value={c.priceTier === 'wholesale' ? t('customer.wholesale') : undefined}
                onPress={() => onPick({ id: c.id, name: c.name, priceTier: c.priceTier })}
                last={i === rows.length - 1}
              />
            ))}
          </ListGroup>
        </>
      )}
    </Sheet>
  );
}

export function PosMenu({ visible, onClose, items }: { visible: boolean; onClose: () => void; items: { key: string; icon: Parameters<typeof ListRow>[0]['icon']; hue: Parameters<typeof ListRow>[0]['hue']; title: string; value?: string; onPress: () => void; danger?: boolean }[] }) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      <ListGroup>
        {items.map((it, i) => (
          <ListRow key={it.key} icon={it.icon} hue={it.hue} title={it.title} value={it.value} tone={it.danger ? 'danger' : undefined} onPress={() => {
              onClose();
              // Run after the sheet's close animation, so alerts/navigation don't fight the modal.
              setTimeout(it.onPress, 260);
            }} last={i === items.length - 1} />
        ))}
      </ListGroup>
    </Sheet>
  );
}

/** Tappable card used on the payment screen for each method. */
export function MethodCard({ label, icon, selected, onPress }: { label: string; icon: 'card' | 'phone' | 'layers' | 'users' | 'book'; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexGrow: 1, flexBasis: '22%', minWidth: 72, alignItems: 'center', gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, borderWidth: 2, borderColor: selected ? colors.primary[500] : colors.paper.line, backgroundColor: selected ? colors.primary[50] : colors.paper.card, opacity: pressed ? 0.85 : 1 })}>
      <Icon name={icon} size={20} color={selected ? colors.primary[700] : colors.ink.mute} />
      <Text numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 12.5, color: selected ? colors.primary[800] : colors.ink.soft }}>{label}</Text>
    </Pressable>
  );
}
