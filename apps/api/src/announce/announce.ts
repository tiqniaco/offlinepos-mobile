/**
 * Super-admin announcements (owner request). Two channels so a message always arrives:
 *  1. push via the Expo Push Service to phones that allowed notifications (sent once, in the background);
 *  2. an in-app inbox copy delivered with the daily check-in (no extra request; works when push is off).
 * Targets: everyone, by country, by plan, by status (trial / active / past_due), or specific businesses.
 */
import { z } from 'zod';
import { uuidv7 } from '@daftarak/shared';
import type { Env } from '../env';

/** Screens an announcement may open (never an arbitrary URL). */
export const ANNOUNCE_URLS = ['/settings/subscription', '/settings/backup', '/settings/printers', '/settings/sessions', '/reports', '/offers', '/(main)/parties', '/(main)/products', '/(main)/sell', 'store'] as const;

export const targetSchema = z.object({
  all: z.boolean().optional(),
  countries: z.array(z.enum(['EG', 'SA'])).optional(),
  plans: z.array(z.string()).optional(),
  statuses: z.array(z.enum(['trial', 'active', 'past_due', 'suspended', 'expired'])).optional(),
  businessIds: z.array(z.string()).max(500).optional(),
});
export type Target = z.infer<typeof targetSchema>;

export const announceSchema = z.object({
  titleAr: z.string().trim().min(2).max(80),
  bodyAr: z.string().trim().min(2).max(500),
  titleEn: z.string().trim().max(80).optional(),
  bodyEn: z.string().trim().max(500).optional(),
  url: z.enum(ANNOUNCE_URLS).optional(),
  target: targetSchema,
  push: z.boolean().default(true),
  /** Shown in the inbox for this many days (also the window for phones that check in later). */
  days: z.number().int().min(1).max(60).default(14),
});

/**
 * Status as the admin should see it: a trial / paid plan whose expiry passed is "expired" (the stored status only
 * changes on events). Free-plan shops never expire; a suspension wins.
 */
export function effectiveStatus(b: { status: string; plan_code: string; plan_expires_at: number }, now: number): string {
  return b.status !== 'suspended' && b.plan_code !== 'free' && b.plan_expires_at <= now ? 'expired' : b.status;
}

/** SQL expression for effectiveStatus on businesses `alias` (binds `now` at ?nowParam). */
export function effectiveStatusSql(alias: string, nowParam: string): string {
  return `CASE WHEN ${alias}.status != 'suspended' AND ${alias}.plan_code != 'free' AND ${alias}.plan_expires_at <= ${nowParam} THEN 'expired' ELSE ${alias}.status END`;
}

/** SQL WHERE (on businesses b) for a target + its bound values. Statuses are effective statuses (see effectiveStatus). */
export function targetSql(t: Target, now = Date.now()): { where: string; args: unknown[] } {
  if (t.all) return { where: '1 = 1', args: [] };
  const parts: string[] = [];
  const args: unknown[] = [];
  const list = (col: string, vals?: string[]) => {
    if (!vals?.length) return;
    parts.push(`${col} IN (${vals.map(() => '?').join(', ')})`);
    args.push(...vals);
  };
  list('b.country', t.countries);
  list('b.plan_code', t.plans);
  if (t.statuses?.length) {
    parts.push(`${effectiveStatusSql('b', '?')} IN (${t.statuses.map(() => '?').join(', ')})`);
    args.push(now, ...t.statuses);
  }
  list('b.id', t.businessIds);
  return { where: parts.length ? parts.join(' AND ') : '0 = 1', args };
}

export function matches(t: Target, b: { id: string; country: string; plan_code: string; status: string }): boolean {
  if (t.all) return true;
  if (!t.countries?.length && !t.plans?.length && !t.statuses?.length && !t.businessIds?.length) return false;
  return (!t.countries?.length || t.countries.includes(b.country as 'EG')) && (!t.plans?.length || t.plans.includes(b.plan_code)) && (!t.statuses?.length || t.statuses.includes(b.status as 'trial')) && (!t.businessIds?.length || t.businessIds.includes(b.id));
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound?: 'default';
  channelId?: string;
}

/** Expo Push API, batches of 100. Returns [sent, failed]. Invalid tokens are cleared. */
export async function sendExpoPush(env: Env, messages: PushMessage[], f: typeof fetch = fetch): Promise<[number, number]> {
  let ok = 0;
  let bad = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      const res = await f('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(batch),
      });
      const json = (await res.json().catch(() => ({}))) as { data?: { status: string; details?: { error?: string } }[] };
      (json.data ?? batch.map(() => ({ status: res.ok ? 'ok' : 'error' } as { status: string; details?: { error?: string } }))).forEach((r, j) => {
        if (r.status === 'ok') ok++;
        else {
          bad++;
          if (r.details?.error === 'DeviceNotRegistered') void env.DB.prepare(`UPDATE devices SET push_token = NULL WHERE push_token = ?1`).bind(batch[j]!.to).run();
        }
      });
    } catch {
      bad += batch.length;
    }
  }
  return [ok, bad];
}

/**
 * SQL filter (on announcements a) matching `matches()` for one business, so non-targeted rows never consume the
 * per-check-in cap (a backlog of other shops' messages can never push this shop's message out).
 * Bind order: ?country, ?plan, ?status, ?businessId at positions given by `base`.
 */
export function targetFilterSql(base: number): string {
  const [co, pl, st, id] = [base, base + 1, base + 2, base + 3];
  const has = (k: string) => `COALESCE(json_array_length(a.target_json, '$.${k}'), 0) > 0`;
  const inList = (k: string, p: number) => `(NOT ${has(k)} OR EXISTS (SELECT 1 FROM json_each(a.target_json, '$.${k}') WHERE value = ?${p}))`;
  return `(json_extract(a.target_json, '$.all') = 1 OR (
    (${has('countries')} OR ${has('plans')} OR ${has('statuses')} OR ${has('businessIds')})
    AND ${inList('countries', co)} AND ${inList('plans', pl)} AND ${inList('statuses', st)} AND ${inList('businessIds', id)}))`;
}

export interface AnnouncementRow {
  id: string;
  title_ar: string;
  body_ar: string;
  title_en: string | null;
  body_en: string | null;
  url: string | null;
  target_json: string;
  created_at: number;
}

/** Announcements for this business created after `since` (and not older than 14 days before `activatedAt`), oldest first, capped. */
export async function pendingAnnouncements(
  env: Env,
  business: { id: string; country: string; plan_code: string; status: string },
  since: number,
  activatedAt: number,
  now: number,
  limit = 20,
): Promise<AnnouncementRow[]> {
  const r = await env.DB.prepare(
    `SELECT a.id, a.title_ar, a.body_ar, a.title_en, a.body_en, a.url, a.target_json, a.created_at FROM announcements a
     WHERE a.created_at > ?1 AND a.created_at >= ?2 - 14 * 86400000 AND a.expires_at > ?3 AND a.cancelled_at IS NULL
       AND ${targetFilterSql(5)}
     ORDER BY a.created_at, a.id LIMIT ?4`,
  )
    .bind(since, activatedAt, now, limit, business.country, business.plan_code, business.status, business.id)
    .all<AnnouncementRow>();
  // Belt and braces: the JS matcher is the reference definition.
  return r.results.filter((a) => matches(JSON.parse(a.target_json) as Target, business));
}

/** Cairo wall-clock time, Latin digits: 24/11/2026 14:05. */
export function cairoTime(ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${g('day')}/${g('month')}/${g('year')} ${g('hour')}:${g('minute')}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** The new phone itself does not get its own "new device" alert in the inbox (see /checkin). */
export function excludedFor(targetJson: string, deviceId: string): boolean {
  try {
    const t = JSON.parse(targetJson) as { exceptDeviceIds?: unknown };
    return Array.isArray(t.exceptDeviceIds) && t.exceptDeviceIds.includes(deviceId);
  } catch {
    return false;
  }
}

/**
 * Security alert: a new phone was registered on this shop (/devices/attach, /devices/activate). Targeted announcement
 * to the business (inbox copy on the next check-in of the other phones) + a push to the shop's other phones that
 * allowed notifications (also the phone that was just signed out, so the owner hears about it right away).
 */
export async function newDeviceAlert(
  env: Env,
  business: { id: string },
  device: { id: string; model?: string | null; platform: string },
  now: number,
  push?: (env: Env, messages: PushMessage[]) => Promise<[number, number]>,
): Promise<string> {
  const id = uuidv7(now);
  const model = (device.model || '').trim().slice(0, 60) || (device.platform === 'ios' ? 'iPhone' : device.platform === 'android' ? 'Android' : device.platform);
  const titleAr = 'تسجيل دخول من جهاز جديد';
  const bodyAr = `اتسجل دخول على حسابك من جهاز جديد: ${model} — ${cairoTime(now)}. لو مش إنت، افتح «الأجهزة المسجل عليها» واقفل الجلسة وغيّر كلمة السر.`;
  const url = '/settings/sessions';
  const target = { businessIds: [business.id], exceptDeviceIds: [device.id] };
  await env.DB.prepare(
    `INSERT INTO announcements (id, title_ar, body_ar, title_en, body_en, url, target_json, push, created_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, 'system:new_device', ?8, ?9)`,
  )
    .bind(id, titleAr, bodyAr, 'New device sign-in', `Your account was signed in on a new device: ${model} — ${cairoTime(now)} (Cairo). If it wasn't you, open "Signed-in devices", end the session and change your password.`, url, JSON.stringify(target), now, now + 14 * 86_400_000)
    .run();
  if (push) {
    try {
      const tokens = (await env.DB.prepare(`SELECT DISTINCT push_token AS t FROM devices WHERE business_id = ?1 AND id != ?2 AND push_token IS NOT NULL`).bind(business.id, device.id).all<{ t: string }>()).results.map((r) => r.t);
      if (tokens.length) {
        const [sent, failed] = await push(env, tokens.map((to) => ({ to, title: titleAr, body: bodyAr, sound: 'default' as const, channelId: 'default', data: { kind: 'announcement', id, url } })));
        await env.DB.prepare(`UPDATE announcements SET push_sent = ?2, push_failed = ?3 WHERE id = ?1`).bind(id, sent, failed).run();
      }
    } catch {
      // best effort: the inbox copy still arrives with the next check-in
    }
  }
  return id;
}

/** This phone (install id) was registered on the shop before: re-attaching it is not a "new device". */
export async function isKnownInstall(env: Env, businessId: string, installId: string): Promise<boolean> {
  return !!(await env.DB.prepare(`SELECT 1 AS x FROM devices WHERE business_id = ?1 AND install_id = ?2 LIMIT 1`).bind(businessId, installId).first());
}
