import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { businessDay, formatMinor, roleHas } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { countParties, listParties, owed, partyTotals } from '../../domain/parties/parties';
import { customersDue } from '../../domain/parties/statement';
import { PartiesListView, type PartyFilter, type PartyListItem } from '../../features/parties/PartiesListView';
import { useCurrency } from '../../features/inventory/useInvCtx';
import { openWhatsApp } from '../../features/export/whatsapp';
import { reminderText } from '../../features/parties/format';
import { Tip } from '../../features/Tip';
import { EyeToggle } from '../../features/privacy/EyeToggle';
import { useSensitive } from '../../state/privacy';
import { ListGroup, ListRow } from '../../ui';
import { ListExport } from '../../features/export/ListExport';
import { partiesListDoc } from '../../features/export/lists';
import { bizHeader } from '../../features/export/builders';
import { isCashierPhone } from '../../domain/sync/role';

export default function Parties() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ type?: string; filter?: string; t?: string }>();
  const currency = useCurrency();
  const { masked } = useSensitive();
  const user = useApp((s) => s.user)!;
  const business = useApp((s) => s.business);
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const reminderDays = useApp((s) => s.settings.reminderDays ?? 30);
  const template = useApp((s) => s.settings.reminderTemplate) || t('parties.reminderDefault');
  const [type, setType] = useState<'C' | 'S'>(params.type === 'S' ? 'S' : 'C');
  const [filter, setFilter] = useState<PartyFilter>((params.filter as PartyFilter) ?? 'all');
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // debounced search text
  const [rows, setRows] = useState<PartyListItem[]>([]);
  const [totals, setTotals] = useState({ owedMinor: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  // Links from home carry a nonce (t) so tapping the same shortcut again re-applies its filter.
  useEffect(() => {
    if (params.type === 'S' || params.type === 'C') setType(params.type);
    setFilter((params.filter as PartyFilter) ?? 'all');
  }, [params.type, params.filter, params.t]);

  useEffect(() => {
    const h = setTimeout(() => setDq(q), 250);
    return () => clearTimeout(h);
  }, [q]);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    const db = getDb();
    const today = businessDay(Date.now(), tz);
    try {
      let next: PartyListItem[];
      if (type === 'C' && filter === 'late') {
        const due = await customersDue(db, today, reminderDays);
        const all = await listParties(db, 'C', { search: dq, filter: 'owing', limit: 1000 });
        const byId = new Map(all.map((r) => [r.id, r]));
        next = due.filter((d) => byId.has(d.id)).map((d) => ({ id: d.id, name: byId.get(d.id)!.name, mobile: byId.get(d.id)!.mobile, owedMinor: d.balanceMinor, lateDays: d.days }));
      } else {
        const r = await listParties(db, type, { search: dq, filter: filter === 'late' ? 'all' : filter, sort: filter === 'all' ? 'recent' : 'balance' });
        next = r.map((x) => ({ id: x.id, name: x.name, mobile: x.mobile, owedMinor: owed(type, x.balanceMinor) }));
      }
      const tot = await partyTotals(db, type);
      const n = await countParties(db, type);
      if (my !== reqId.current) return; // a newer search/filter already started
      setRows(next);
      setTotals({ owedMinor: tot.owedMinor, count: n });
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [type, filter, dq, tz, reminderDays]);

  // Reload when the query changes, and on focus (via a ref so typing doesn't re-run the focus effect).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focused.current) void loadRef.current().catch(() => undefined);
      focused.current = true;
    }, []),
  );

  const canExport = roleHas(user.permissions, type === 'C' ? 'reports.view' : 'purchases.manage');
  const canImport = roleHas(user.permissions, type === 'C' ? 'parties.manage' : 'purchases.manage') && !isCashierPhone();
  /** Every party matching the screen's type, filter and search (not only the rows on screen). */
  const exportRows = async () => {
    const db = getDb();
    const all = await listParties(db, type, { search: dq, filter: filter === 'late' ? 'owing' : filter, sort: 'name', limit: 100_000 });
    if (!(type === 'C' && filter === 'late')) return all;
    const due = new Set((await customersDue(db, businessDay(Date.now(), tz), reminderDays)).map((d) => d.id));
    return all.filter((r) => due.has(r.id));
  };
  const filterLabel = [
    filter === 'all' ? null : filter === 'late' ? t('parties.late') : filter === 'credit' ? t('parties.creditC') : t(type === 'C' ? 'parties.owingC' : 'parties.owingS'),
    dq.trim() ? t('lists.search', { q: dq.trim() }) : null,
  ]
    .filter(Boolean)
    .join(' — ');

  return (
    <PartiesListView
      actions={
        canExport || canImport ? (
          <ListExport
            what={type === 'C' ? 'customers_list' : 'suppliers_list'}
            label={canExport ? 'Excel / PDF' : 'Excel'}
            testID="parties-export"
            build={async () => partiesListDoc(type, canExport ? await exportRows() : [], await bizHeader(), { filterLabel: filterLabel || null })}
            hideExport={!canExport}
            extra={(close) =>
              canImport ? (
                <ListGroup>
                  <ListRow
                    icon="upload"
                    hue="primary"
                    testID="parties-import"
                    title={t(type === 'C' ? 'lists.importC' : 'lists.importS')}
                    last
                    onPress={() => {
                      close();
                      router.push({ pathname: '/parties/import', params: { type } });
                    }}
                  />
                </ListGroup>
              ) : null
            }
          />
        ) : null
      }
      topInset={insets.top}
      type={type}
      rows={rows}
      totalOwedMinor={totals.owedMinor}
      count={totals.count}
      search={q}
      loading={loading}
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
      tip={<Tip id="parties" />}
      masked={masked}
      eye={<EyeToggle testID="parties-eye" />}
      onRemind={(id) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return;
        void openWhatsApp(r.mobile, reminderText(template, { name: r.name, amount: `${formatMinor(r.owedMinor)} ${currency === 'SAR' ? 'ر.س' : 'ج.م'}`, business: business?.name ?? '', days: r.lateDays ?? 0 }));
      }}
    />
  );
}
