/** «موبايل متابعة» on THIS phone: which shop it follows (kv_meta in the encrypted DB) and leaving that mode. */
import type { GetSnapshotResponse } from '@daftarak/shared';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { kvMeta } from '../../db/schema';
import { getMeta, setMeta } from '../../domain/device';
import { deleteSecret, SECURE_KEYS } from '../../lib/secure';
import { clearAccessToken } from '../../lib/session';

export interface FollowedShop {
  businessId: string;
  deviceId: string;
  name: string;
  country: 'EG' | 'SA';
}

const SHOP = 'follow.shop';
const LAST = 'follow.last';

export async function followedShop(): Promise<FollowedShop | null> {
  const v = await getMeta(getDb(), SHOP);
  if (!v) return null;
  try {
    return JSON.parse(v) as FollowedShop;
  } catch {
    return null;
  }
}

export const saveFollowedShop = (s: FollowedShop) => setMeta(getDb(), SHOP, JSON.stringify(s));

/** The last summary received (shown offline). */
export async function lastSnapshot(): Promise<GetSnapshotResponse | null> {
  const v = await getMeta(getDb(), LAST);
  try {
    return v ? (JSON.parse(v) as GetSnapshotResponse) : null;
  } catch {
    return null;
  }
}
export const saveLastSnapshot = (r: GetSnapshotResponse) => setMeta(getDb(), LAST, JSON.stringify(r));

/** Leaves follower mode on this phone: forget the shop, its last summary and the login. */
export async function leaveFollowMode() {
  const db = getDb();
  await db.delete(kvMeta).where(eq(kvMeta.key, SHOP));
  await db.delete(kvMeta).where(eq(kvMeta.key, LAST));
  await deleteSecret(SECURE_KEYS.refreshToken).catch(() => undefined);
  clearAccessToken();
}
