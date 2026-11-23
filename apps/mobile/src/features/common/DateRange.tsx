import { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { addDays } from '@daftarak/shared';
import { Chip, TextField } from '../../ui';

export type RangeKey = 'today' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'all' | 'custom';

/** Business-day ranges (YYYYMMDD) for the presets, relative to `today`. */
export function presetRange(k: RangeKey, today: number): [number, number] {
  const y = Math.floor(today / 10000);
  const m = Math.floor(today / 100) % 100;
  switch (k) {
    case 'today':
      return [today, today];
    case 'week':
      return [addDays(today, -6), today];
    case 'month':
      return [y * 10000 + m * 100 + 1, today];
    case 'lastMonth': {
      const first = y * 10000 + m * 100 + 1;
      const lastPrev = addDays(first, -1);
      return [Math.floor(lastPrev / 100) * 100 + 1, lastPrev];
    }
    case 'quarter':
      return [addDays(today, -89), today];
    case 'year':
      return [y * 10000 + 101, today];
    default:
      return [20000101, today];
  }
}

const toText = (d: number) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, '0')}-${String(d % 100).padStart(2, '0')}`;
/** "2026-12-01" or "2026/12/01" → 20261201; null when it isn't a valid date. */
export const parseDayText = (s: string): number | null => {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const v = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  return Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31 ? v : null;
};

/**
 * Preset chips (النهارده، الشهر ده، الشهر اللي فات…) + optional custom from/to (YYYY-MM-DD, Latin digits).
 * No native date picker on purpose: @react-native-community/datetimepicker is not in the build.
 */
export function DateRangeBar({ value, today, onChange, presets = ['today', 'month', 'lastMonth', 'quarter', 'year', 'all', 'custom'] }: { value: { key: RangeKey; from: number; to: number }; today: number; onChange: (v: { key: RangeKey; from: number; to: number }) => void; presets?: RangeKey[] }) {
  const { t } = useTranslation();
  const [from, setFrom] = useState(toText(value.from));
  const [to, setTo] = useState(toText(value.to));
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {presets.map((k) => (
          <Chip
            key={k}
            label={t(`range.${k}`)}
            selected={value.key === k}
            onPress={() => {
              if (k === 'custom') return onChange({ ...value, key: 'custom' });
              const [f, tt] = presetRange(k, today);
              setFrom(toText(f));
              setTo(toText(tt));
              onChange({ key: k, from: f, to: tt });
            }}
          />
        ))}
      </View>
      {value.key === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <TextField label={t('range.from')} value={from} ltr placeholder="2026-01-01" keyboardType="numbers-and-punctuation" onChangeText={(s) => { setFrom(s); const v = parseDayText(s); if (v) onChange({ key: 'custom', from: v, to: value.to }); }} />
          </View>
          <View style={{ flex: 1 }}>
            <TextField label={t('range.to')} value={to} ltr placeholder="2026-12-31" keyboardType="numbers-and-punctuation" onChangeText={(s) => { setTo(s); const v = parseDayText(s); if (v) onChange({ key: 'custom', from: value.from, to: v }); }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}
