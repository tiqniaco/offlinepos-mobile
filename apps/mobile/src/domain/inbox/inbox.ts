/**
 * In-app inbox for messages from Daftarak (super-admin announcements).
 * Arrive with the daily check-in (always) or as a push (instant); stored once by id.
 */
import { count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../../db/types';
import { inbox } from '../../db/schema';
import { withTx } from '../../db/tx';

export interface Announcement {
  id: string;
  titleAr: string;
  bodyAr: string;
  titleEn: string | null;
  bodyEn: string | null;
  url: string | null;
  at: number;
}

/** Only these in-app screens may be opened from a message (mirrors the server allow-list). */
const SAFE = /^(\/settings\/(subscription|backup|printers|sessions)|\/reports|\/offers|\/\(main\)\/(parties|products|sell)|store)$/;
export const safeUrl = (u: string | null | undefined) => (u && SAFE.test(u) ? (u === '/(main)/sell' ? '/sales/pos' : u) : null);

/** Store new messages; returns the ones that were not already there. Keeps the newest 100. */
export async function saveAnnouncements(db: Db, list: Announcement[]): Promise<Announcement[]> {
  if (!list.length) return [];
  return withTx(db, async (tx) => {
    const have = new Set((await tx.select({ id: inbox.id }).from(inbox).where(inArray(inbox.id, list.map((a) => a.id)))).map((r) => r.id));
    const fresh = list.filter((a) => !have.has(a.id));
    for (const a of fresh) {
      await tx.insert(inbox).values({ id: a.id, titleAr: a.titleAr.slice(0, 80), bodyAr: a.bodyAr.slice(0, 500), titleEn: a.titleEn, bodyEn: a.bodyEn, url: safeUrl(a.url), at: a.at });
    }
    const old = await tx.select({ id: inbox.id }).from(inbox).orderBy(desc(inbox.at)).limit(1000).offset(100);
    if (old.length) await tx.delete(inbox).where(inArray(inbox.id, old.map((r) => r.id)));
    return fresh;
  });
}

export async function listInbox(db: Db) {
  return db.select().from(inbox).orderBy(desc(inbox.at)).limit(100);
}

export async function unreadCount(db: Db): Promise<number> {
  return (await db.select({ n: count() }).from(inbox).where(isNull(inbox.readAt)))[0]?.n ?? 0;
}

export async function latestUnread(db: Db) {
  return (await db.select().from(inbox).where(isNull(inbox.readAt)).orderBy(desc(inbox.at)).limit(1))[0] ?? null;
}

export async function markRead(db: Db, id: string, now = Date.now()) {
  await withTx(db, (tx) => tx.update(inbox).set({ readAt: now }).where(eq(inbox.id, id)).then(() => undefined));
}

export async function markAllRead(db: Db, now = Date.now()) {
  await withTx(db, (tx) => tx.update(inbox).set({ readAt: now }).where(isNull(inbox.readAt)).then(() => undefined));
}
