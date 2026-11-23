/**
 * Super-admin announcements (owner request). Two channels so a message always arrives:
 *  1. push via the Expo Push Service to phones that allowed notifications (sent once, in the background);
 *  2. an in-app inbox copy delivered with the daily check-in (no extra request; works when push is off).
 * Targets: everyone, by country, by plan, by status (trial / active / past_due), or specific businesses.
 */
import { z } from 'zod';
import type { Env } from '../env';

/** Screens an announcement may open (never an arbitrary URL). */
export const ANNOUNCE_URLS = ['/settings/subscription', '/settings/backup', '/settings/printers', '/reports', '/offers', '/(main)/parties', '/(main)/products', '/(main)/sell', 'store'] as const;

export const targetSchema = z.object({
  all: z.boolean().optional(),
  countries: z.array(z.enum(['EG', 'SA'])).optional(),
  plans: z.array(z.string()).optional(),
  statuses: z.array(z.enum(['trial', 'active', 'past_due', 'suspended'])).optional(),
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

/** SQL WHERE (on businesses b) for a target + its bound values. */
export function targetSql(t: Target): { where: string; args: unknown[] } {
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
  list('b.status', t.statuses);
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
