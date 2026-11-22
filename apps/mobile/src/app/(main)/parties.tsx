import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { businessDay, formatMinor, roleHas } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { listParties, owed, partyTotals } from '../../domain/parties/parties';
import { customersDue } from '../../domain/parties/statement';
import { PartiesListView, type PartyFilter, type PartyListItem } from '../../features/parties/PartiesListView';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { openWhatsApp } from '../../features/export/whatsapp';
import { reminderText } from '../../features/parties/format';

export default function Parties() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ type?: string; filter?: string }>();
  const currency = useCurrency();
  const user = useApp((s) => s.user)!;
  const business = useApp((s) => s.business);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const reminderDays = useApp((s) => s.settings.reminderDays ?? 30);
  const template = useApp((s) => s.settings.reminderTemplate) || t('parties.reminderDefault');
  const [type, setType] = useState<'C' | 'S'>(params.type === 'S' ? 'S' : 'C');
  const [filter, setFilter] = useState<PartyFilter>((params.filter as PartyFilter) ?? 'all');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PartyListItem[]>([]);
  const [totals, setTotals] = useState({ owedMinor: 0, count: 0 });

  useEffect(() => {
    if (params.type === 'S' || params.type === 'C') setType(params.type);
    if (params.filter) setFilter(params.filter as PartyFilter);
  }, [params.type, params.filter]);

  const load = useCallback(async () => {
    const db = getDb();
    const today = businessDay(Date.now(), tz);
    if (type === 'C' && filter === 'late') {
      const due = await customersDue(db, today, reminderDays);
      const all = await listParties(db, 'C', { search: q, filter: 'owing', limit: 1000 });
      const byId = new Map(all.map((r) => [r.id, r]));
      setRows(due.filter((d) => byId.has(d.id)).map((d) => ({ id: d.id, name: byId.get(d.id)!.name, mobile: byId.get(d.id)!.mobile, owedMinor: d.balanceMinor, lateDays: d.days })));
    } else {
      const r = await listParties(db, type, { search: q, filter: filter === 'late' ? 'all' : filter, sort: filter === 'all' ? 'recent' : 'balance' });
      setRows(r.map((x) => ({ id: x.id, name: x.name, mobile: x.mobile, owedMinor: owed(type, x.balanceMinor) })));
    }
    const tot = await partyTotals(db, type);
    const n = (await listParties(db, type, { limit: 100_000 })).length;
    setTotals({ owedMinor: tot.owedMinor, count: n });
  }, [type, filter, q, tz, reminderDays]);

  useEffect(() => {
    const h = setTimeout(() => void load(), 150);
    return () => clearTimeout(h);
  }, [load]);
  useFocusEffect(useCallback(() => void load(), [load]));

  return (
    <PartiesListView
      topInset={insets.top}
      type={type}
      rows={rows}
      totalOwedMinor={totals.owedMinor}
      count={totals.count}
      search={q}
      filter={filter}
      currency={currency}
      lang={i18n.language}
      canAdd={roleHas(user.permissions, type === 'C' ? 'parties.manage' : 'purchases.manage')}
      onType={(x) => {
        setType(x);
        setFilter('all');
      }}
      onSearch={setQ}
      onFilter={setFilter}
      onOpen={(id) => router.push({ pathname: '/parties/[id]', params: { id, type } })}
      onAdd={() => router.push({ pathname: '/parties/form', params: { type } })}
      onRemind={(id) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return;
        void openWhatsApp(r.mobile, reminderText(template, { name: r.name, amount: `${formatMinor(r.owedMinor)} ${currency === 'SAR' ? 'ر.س' : 'ج.م'}`, business: business?.name ?? '', days: r.lateDays ?? 0 }));
      }}
    />
  );
}
