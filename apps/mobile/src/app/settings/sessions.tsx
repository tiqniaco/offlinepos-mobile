import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Card, Text, Button, Banner, IconBadge, colors, fonts } from '../../ui';
import { api } from '../../api/client';
import { accessToken } from '../../lib/session';
import { errorMessage } from '../../lib/errors';
import { dateTimeLabel } from '../../lib/format';

type S = Awaited<ReturnType<typeof api.sessions>>['sessions'][number];

/** Phones signed in to this account; sign out a lost phone remotely (it becomes read-only at its next check-in). */
export default function Sessions() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<S[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    void accessToken()
      .then((tk) => api.sessions(tk))
      .then((r) => setRows(r.sessions), (e) => setErr(errorMessage(t, e)));
  }, [t]);
  useFocusEffect(load);
  const revoke = (s: S) =>
    Alert.alert(t('sessions.revoke'), t('sessions.revokeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sessions.revoke'), style: 'destructive', onPress: () => void accessToken().then((tk) => api.revokeSession(tk, s.id)).then(load, (e) => setErr(errorMessage(t, e))) },
    ]);
  return (
    <Screen back title={t('sessions.title')} subtitle={t('sessions.subtitle')}>
      {err ? <Banner tone="danger" text={err} /> : null}
      {rows?.map((s) => (
        <Card key={s.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <IconBadge name="phone" hue={s.current ? 'leaf' : 'primary'} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21, color: colors.ink.DEFAULT }}>{s.model ?? s.platform ?? '—'} {s.current ? `· ${t('sessions.thisPhone')}` : ''}</Text>
              <Text variant="caption">{t('sessions.lastUsed', { at: dateTimeLabel(i18n.language, s.last_used_at ?? s.created_at) })}</Text>
            </View>
            {!s.current ? <Button compact kind="danger" title={t('sessions.revoke')} onPress={() => revoke(s)} /> : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
