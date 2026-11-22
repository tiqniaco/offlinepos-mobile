import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { Sheet, TextField, ListGroup, ListRow, Avatar, Button } from '../../ui';
import { getDb } from '../../db/client';
import { listParties, owed, type PartyRow } from '../../domain/parties/parties';
import { balanceLabel, partyColor } from './format';

/** Pick a customer or supplier (search, balance shown); "add new" opens the full form. */
export function PartyPicker({ visible, type, currency, lang, onClose, onPick }: { visible: boolean; type: 'C' | 'S'; currency: 'EGP' | 'SAR'; lang: string; onClose: () => void; onPick: (p: PartyRow) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<PartyRow[]>([]);
  useEffect(() => {
    if (!visible) return;
    const h = setTimeout(() => void listParties(getDb(), type, { search: q, sort: 'recent', limit: 40 }).then(setRows), 150);
    return () => clearTimeout(h);
  }, [q, visible, type]);
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t(type === 'C' ? 'parties.pickC' : 'parties.pickS')}
      footer={<Button kind="secondary" icon="plus" title={t(type === 'C' ? 'parties.newC' : 'parties.newS')} onPress={() => { onClose(); router.push({ pathname: '/parties/form', params: { type, name: q } }); }} />}
    >
      <TextField icon="search" placeholder={t('parties.search')} value={q} onChangeText={setQ} latinDigits={false} autoFocus />
      <ListGroup>
        {rows.map((r, i) => {
          const b = balanceLabel(type, owed(type, r.balanceMinor), currency, lang);
          return <ListRow key={r.id} leading={<Avatar name={r.name} color={partyColor(r.id)} size={34} />} title={r.name} subtitle={r.balanceMinor ? `${b.tag} ${b.text}` : r.mobile ? `+${r.mobile}` : undefined} onPress={() => onPick(r)} last={i === rows.length - 1} />;
        })}
      </ListGroup>
    </Sheet>
  );
}
