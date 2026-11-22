import { useEffect, useState } from 'react';
import { formatMinor, formatQty, parseMinor, parseQtyMilli } from '@daftarak/shared';
import { TextField, type TextFieldProps } from './TextField';

type Base = Omit<TextFieldProps, 'value' | 'onChangeText' | 'keyboardType' | 'onChange'>;

/** Money input in minor units. Shows "12.50", accepts Arabic digits, rejects >2 decimals. */
export function MoneyField({ valueMinor, onValue, ...rest }: Base & { valueMinor: number | null; onValue: (v: number | null) => void }) {
  const [text, setText] = useState(valueMinor == null ? '' : formatMinor(valueMinor, { grouping: false }));
  useEffect(() => {
    const parsed = parseMinor(text);
    if (parsed !== valueMinor) setText(valueMinor == null ? '' : formatMinor(valueMinor, { grouping: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMinor]);
  return (
    <TextField
      {...rest}
      ltr
      keyboardType="decimal-pad"
      value={text}
      onChangeText={(v) => {
        const clean = v.replace(/[^\d.]/g, '');
        if (clean !== '' && parseMinor(clean) == null && !/^\d+\.$/.test(clean)) return;
        setText(clean);
        onValue(clean === '' ? null : parseMinor(clean.replace(/\.$/, '')));
      }}
    />
  );
}

/** Quantity input in milli-units ("1.25" → 1250). Fractions only if the unit allows them. */
export function QtyField({ valueMilli, onValue, allowFraction = true, ...rest }: Base & { valueMilli: number | null; onValue: (v: number | null) => void; allowFraction?: boolean }) {
  const [text, setText] = useState(valueMilli == null ? '' : formatQty(valueMilli));
  useEffect(() => {
    if (parseQtyMilli(text) !== valueMilli) setText(valueMilli == null ? '' : formatQty(valueMilli));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueMilli]);
  return (
    <TextField
      {...rest}
      ltr
      keyboardType={allowFraction ? 'decimal-pad' : 'number-pad'}
      value={text}
      onChangeText={(v) => {
        const clean = v.replace(allowFraction ? /[^\d.]/g : /\D/g, '');
        if (clean !== '' && parseQtyMilli(clean.replace(/\.$/, ''), allowFraction) == null) return;
        setText(clean);
        onValue(clean === '' ? null : parseQtyMilli(clean.replace(/\.$/, ''), allowFraction));
      }}
    />
  );
}
