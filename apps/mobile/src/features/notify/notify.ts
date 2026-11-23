/**
 * Local notifications only (no server push, no extra requests): a morning summary (late customers, supplier dues,
 * stock), trial/plan ending, and a stale-backup nudge. Re-planned every time the app opens, from fresh data.
 * Off with المظهر → الإشعارات.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import i18n from 'i18next';
import { businessDay } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { computeReminders, summaryLines } from '../../domain/notify/reminders';
import { money } from '../../lib/format';
import { lastBackup } from '../backup/service';

const TAG = 'daftarak';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = (k: string, o?: Record<string, unknown>) => (i18n.t as any)(k, o) as string;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

async function allowed(ask: boolean): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!ask || !cur.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Next local 09:30 (or tomorrow if past). */
function nextMorning(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(9, 30, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}

export async function planNotifications(opts: { ask?: boolean } = {}) {
  try {
    const st = useApp.getState();
    if (st.settings.notifications === false || !(await allowed(!!opts.ask))) return;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('daily', { name: t('notify.channel'), importance: Notifications.AndroidImportance.DEFAULT });
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) if ((n.content.data as { tag?: string } | undefined)?.tag === TAG) await Notifications.cancelScheduledNotificationAsync(n.identifier);

    const db = getDb();
    const tz = st.settings.timezone ?? 'Africa/Cairo';
    const cur = st.business?.currency ?? 'EGP';
    const r = await computeReminders(db, businessDay(Date.now(), tz), st.settings.reminderDays ?? 30);
    const lines = summaryLines(r, t, (v) => money(v, cur, i18n.language));
    const at = nextMorning();
    if (lines.length) {
      await Notifications.scheduleNotificationAsync({
        content: { title: t('notify.morningTitle'), body: lines.join('\n'), data: { tag: TAG, url: r.lateCustomers ? '/(main)/parties?filter=late' : '/(main)/products' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: 'daily' },
      });
    }
    const lic = st.licence;
    const days = lic?.trialDaysLeft ?? lic?.graceDaysLeft ?? null;
    if (days != null && days <= 3 && days >= 0) {
      await Notifications.scheduleNotificationAsync({
        content: { title: t(lic?.trialDaysLeft != null ? 'notify.trialTitle' : 'notify.graceTitle'), body: t('notify.trialBody', { n: days }), data: { tag: TAG, url: '/settings/subscription' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at.getTime() + 60_000), channelId: 'daily' },
      });
    }
    const lb = await lastBackup().catch(() => null);
    if (!lb || Date.now() - lb.at > 7 * 86_400_000) {
      await Notifications.scheduleNotificationAsync({
        content: { title: t('notify.backupTitle'), body: t('notify.backupBody'), data: { tag: TAG, url: '/settings/backup' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at.getTime() + 8 * 3_600_000), channelId: 'daily' },
      });
    }
  } catch {
    /* notifications never break the app */
  }
}

/** Tapping a notification opens the right screen. */
export function onNotificationTap(go: (url: string) => void) {
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const url = (resp.notification.request.content.data as { url?: string } | undefined)?.url;
    if (url) go(url);
  });
  return () => sub.remove();
}
