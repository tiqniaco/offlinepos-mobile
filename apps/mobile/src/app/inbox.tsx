import { useCallback, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen, Text, Button, EmptyState, IconBadge, Icon, colors, fonts } from '../ui';
import { getDb } from '../db/client';
import { listInbox, markAllRead, markRead } from '../domain/inbox/inbox';
import { openNotificationUrl } from '../features/notify/notify';
import { useApp } from '../state/app';
import { dateTimeLabel } from '../lib/format';
import { fx } from '../ui/fx';

type Row = Awaited<ReturnType<typeof listInbox>>[number];

/** Messages from Daftarak (offers, updates, maintenance). Tap → mark read and open its screen. */
export default function Inbox() {
  const { t, i18n } = useTranslation();
  const en = i18n.language === 'en';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => void listInbox(getDb()).then(setRows), []);
  useFocusEffect(load);
  const bump = () => useApp.getState().set({ inboxBump: Date.now() });
  const tap = async (r: Row) => {
    setOpen((o) => (o === r.id ? null : r.id));
    if (!r.readAt) {
      await markRead(getDb(), r.id);
      bump();
      load();
    }
  };
  const unread = rows?.filter((r) => !r.readAt).length ?? 0;
  return (
    <Screen
      back
      title={t('inbox.title')}
      subtitle={t('inbox.subtitle')}
      right={unread ? <Button compact kind="ghost" title={t('inbox.readAll')} onPress={() => void markAllRead(getDb()).then(() => (bump(), load(), fx.success()))} /> : undefined}
    >
      {rows && rows.length === 0 ? <EmptyState icon="bell" hue="sky" title={t('inbox.empty')} body={t('inbox.emptyBody')} /> : null}
      {rows?.map((r) => {
        const title = (en && r.titleEn) || r.titleAr;
        const body = (en && r.bodyEn) || r.bodyAr;
        const expanded = open === r.id;
        return (
          <Pressable
            key={r.id}
            testID={`inbox-${r.id}`}
            onPress={() => void tap(r)}
            style={({ pressed }) => ({ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: r.readAt ? colors.paper.card : colors.primary[50], borderWidth: 1, borderColor: r.readAt ? colors.paper.line : colors.primary[100], opacity: pressed ? 0.9 : 1 })}
          >
            <IconBadge name="bell" hue={r.readAt ? 'ink' : 'primary'} size={34} />
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {!r.readAt ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary[600] }} /> : null}
                <Text style={{ flex: 1, fontFamily: r.readAt ? fonts.medium : fonts.semibold, fontSize: 14, lineHeight: 21, color: colors.ink.DEFAULT }} numberOfLines={expanded ? undefined : 1}>
                  {title}
                </Text>
              </View>
              <Text variant="caption" numberOfLines={expanded ? undefined : 2}>
                {body}
              </Text>
              <Text style={{ fontSize: 11, lineHeight: 16, color: colors.ink.mute, fontFamily: fonts.regular }}>{dateTimeLabel(i18n.language, r.at)}</Text>
              {expanded && r.url ? (
                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                  <Button compact title={t(r.url === 'store' ? 'inbox.update' : 'inbox.open')} onPress={() => openNotificationUrl(r.url, (u) => router.push(u as never))} />
                </View>
              ) : null}
            </View>
            {r.url && !expanded ? <Icon name="chevron" size={14} color={colors.ink.mute} /> : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}
