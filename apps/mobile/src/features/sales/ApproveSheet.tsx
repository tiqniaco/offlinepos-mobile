import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Pressable } from '../../ui/Press';
import { useTranslation } from 'react-i18next';
import { roleHas } from '@daftarak/shared';
import { Sheet, Text, Avatar, PinDots, PinPad, Button, colors, fonts } from '../../ui';
import { getDb } from '../../db/client';
import { listActiveUsers, unlockWithPin, PinError, type SessionUser } from '../../domain/auth/users';

/**
 * Manager PIN override (SPEC §5: discounts capped per role). Verifies the approver's PIN with the
 * normal lock-out rules; the posting service re-checks the approver's own caps and audits it.
 */
export function ApproveSheet({ visible, onClose, onApproved, needs }: { visible: boolean; onClose: () => void; onApproved: (u: SessionUser) => void; needs: 'discount' | 'price' }) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<Awaited<ReturnType<typeof listActiveUsers>>>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (visible) void listActiveUsers(getDb()).then((u) => setUsers(u.filter((x) => x.roleKey !== 'cashier')));
    setPin('');
    setMsg(null);
  }, [visible]);
  const submit = async () => {
    if (!sel) return;
    try {
      const u = await unlockWithPin(getDb(), sel, pin);
      if (needs === 'price' && !roleHas(u.permissions, 'price.change')) return setMsg(t('approve.noRight'));
      onApproved(u);
    } catch (e) {
      setPin('');
      setMsg(e instanceof PinError && e.code === 'locked' ? t('lock.lockedFor', { time: '…' }) : t('lock.wrong'));
    }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={t('approve.title')} footer={<Button title={t('approve.ok')} disabled={!sel || pin.length < 4} onPress={submit} />}>
      <Text variant="body">{t('approve.body')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {users.map((u) => (
          <Pressable key={u.id} onPress={() => { setSel(u.id); setPin(''); setMsg(null); }} style={{ alignItems: 'center', gap: 6, padding: 10, borderRadius: 16, borderWidth: 2, borderColor: sel === u.id ? colors.primary[500] : 'transparent', backgroundColor: colors.paper.card }}>
            <Avatar name={u.name} color={u.color} size={46} />
            <Text style={{ fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.ink.DEFAULT }}>{u.name}</Text>
          </Pressable>
        ))}
      </View>
      {sel ? (
        <View style={{ alignItems: 'center', gap: 12 }}>
          <PinDots count={pin.length} total={Math.max(4, pin.length)} error={!!msg} />
          {msg ? <Text style={{ color: colors.rose[700], fontFamily: fonts.medium }}>{msg}</Text> : null}
          <PinPad value={pin} onChange={(v) => { setPin(v); setMsg(null); }} />
        </View>
      ) : null}
    </Sheet>
  );
}
