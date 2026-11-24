/**
 * Messages from Daftarak (super-admin): instant push via Expo when allowed + inbox copy with the daily check-in.
 * Everything else is local (no extra requests): a morning summary (late customers, supplier dues,
 * stock), trial/plan ending, and a stale-backup nudge. Re-planned every time the app opens, from fresh data.
 * Off with المظهر → الإشعارات.
 */
import { Platform } from 'react-native';
import { Linking } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { saveAnnouncements, safeUrl, type Announcement } from '../../domain/inbox/inbox';
import i18n from 'i18next';
import { businessDay } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { computeReminders, summaryLines } from '../../domain/notify/reminders';
import { money } from '../../lib/format';
import { lastBackup } from '../backup/service';
import { lastPortableExport } from '../../domain/backup/portable';
import { IOS_REMIND_DAYS } from '../../domain/backup/folder';

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
    // iOS has no lasting folder access: a weekly reminder to save the shop's own .kashiro file (share sheet).
    if (Platform.OS === 'ios') {
      const lastFile = await lastPortableExport(db).catch(() => null);
      if (!lastFile || Date.now() - lastFile > IOS_REMIND_DAYS * 86_400_000) {
        await Notifications.scheduleNotificationAsync({
          content: { title: t('folderBackup.iosRemindTitle'), body: t('folderBackup.iosRemindBody'), data: { tag: TAG, url: '/settings/backup' } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at.getTime() + 9 * 3_600_000), channelId: 'daily' },
        });
      }
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

let token: string | undefined;
/** Expo push token (no permission prompt here — the home screen asks once). Undefined without an EAS project id. */
export async function pushToken(): Promise<string | undefined> {
  if (token) return token;
  if (Platform.OS === 'web' || useApp.getState().settings.notifications === false || !(await allowed(false))) return undefined;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return undefined;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: t('inbox.channel'), importance: Notifications.AndroidImportance.HIGH });
  token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return token;
}

/** Messages that came with the check-in on a phone without push: show them now as a local notification. */
export async function showAnnouncements(fresh: Announcement[]) {
  if (token || !fresh.length || useApp.getState().settings.notifications === false || !(await allowed(false))) return;
  const en = i18n.language === 'en';
  const a = fresh[fresh.length - 1]!;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: fresh.length > 1 ? t('inbox.many', { n: fresh.length }) : (en && a.titleEn) || a.titleAr,
      body: fresh.length > 1 ? (en && a.titleEn) || a.titleAr : (en && a.bodyEn) || a.bodyAr,
      data: { kind: 'announcement', id: a.id, url: fresh.length > 1 ? null : a.url },
    },
    trigger: null,
  });
}

type Data = { url?: string | null; kind?: string; id?: string } | undefined;

/** A push from Daftarak → into the inbox (works even if it arrives while the app is open). */
async function storePush(n: Notifications.Notification) {
  const d = n.request.content.data as Data;
  if (d?.kind !== 'announcement' || !d.id) return;
  await saveAnnouncements(getDb(), [{ id: d.id, titleAr: n.request.content.title ?? '', bodyAr: n.request.content.body ?? '', titleEn: null, bodyEn: null, url: d.url ?? null, at: Date.now() }]).catch(() => undefined);
  useApp.getState().set({ inboxBump: Date.now() });
}

/** Screens our own local reminders open (morning summary / trial / backup). */
const LOCAL_REMINDER_URLS = new Set(['/(main)/parties?filter=late', '/(main)/products', '/settings/subscription', '/settings/backup']);

/** Open a link from a notification: allow-listed app screens only; 'store' opens the store page (update). */
export function openNotificationUrl(url: string | null | undefined, go: (url: string) => void) {
  const u = safeUrl(url);
  if (u === 'store') {
    const ios = (Constants.expoConfig?.extra as { appStoreId?: string } | undefined)?.appStoreId;
    const link = Platform.OS === 'ios' ? (ios ? `itms-apps://apps.apple.com/app/id${ios}` : null) : 'market://details?id=app.daftarak';
    if (link) void Linking.openURL(link).catch(() => undefined);
  }
  else if (u) go(u);
}

/** Tapping a notification opens the right screen; messages from Daftarak open their link or the inbox. */
export function onNotificationTap(go: (url: string) => void) {
  const got = Notifications.addNotificationReceivedListener((n) => void storePush(n));
  const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
    const d = resp.notification.request.content.data as Data;
    if (d?.kind === 'announcement') {
      void storePush(resp.notification);
      if (d.url) openNotificationUrl(d.url, go);
      else go('/inbox');
      return;
    }
    // Any other push (or a local reminder): only allow-listed screens, never an arbitrary route / deep link.
    const u = typeof d?.url === 'string' ? (safeUrl(d.url) ?? (LOCAL_REMINDER_URLS.has(d.url) ? d.url : null)) : null;
    if (u && u !== 'store') go(u);
  });
  return () => {
    got.remove();
    sub.remove();
  };
}
