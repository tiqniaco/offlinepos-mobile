import { describe, expect, it } from 'vitest';
import { createTestDb } from '../../test/testDb';
import { latestUnread, listInbox, markAllRead, markRead, safeUrl, saveAnnouncements, unreadCount } from './inbox';

const msg = (id: string, at: number, url: string | null = null) => ({ id, titleAr: `عنوان ${id}`, bodyAr: 'نص', titleEn: null, bodyEn: null, url, at });

describe('inbox', () => {
  it('stores each message once, counts unread, marks read, keeps 100, drops unsafe links', async () => {
    const db = createTestDb();
    expect(await saveAnnouncements(db, [msg('a', 1, '/settings/subscription'), msg('b', 2, 'https://evil.example')])).toHaveLength(2);
    expect(await saveAnnouncements(db, [msg('a', 1), msg('c', 3)])).toHaveLength(1); // push + check-in both deliver → once
    expect(await unreadCount(db)).toBe(3);
    const rows = await listInbox(db);
    expect(rows.map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(rows.find((r) => r.id === 'a')!.url).toBe('/settings/subscription');
    expect(rows.find((r) => r.id === 'b')!.url).toBeNull();
    expect((await latestUnread(db))!.id).toBe('c');
    await markRead(db, 'c');
    expect(await unreadCount(db)).toBe(2);
    expect((await latestUnread(db))!.id).toBe('b');
    await markAllRead(db);
    expect(await unreadCount(db)).toBe(0);
    await saveAnnouncements(db, Array.from({ length: 120 }, (_, i) => msg(`m${i}`, 100 + i)));
    expect(await listInbox(db)).toHaveLength(100);
    expect(safeUrl('/(main)/sell')).toBe('/(main)/sell');
    expect(safeUrl('/settings/../x')).toBeNull();
  });
});
