/**
 * Main phone → «موبايل متابعة». Sends the shop summary only when:
 *  - a follower phone exists (learned from the check-in / the push answer; re-asked at most every 6 h when none),
 *  - the figures changed (or once an hour, so the follower sees the shop is online),
 *  - at most once per 5 minutes, a minute after the last change (sales in a row are batched).
 * Silent: offline or any error simply waits for the next change.
 */
import { AppState } from 'react-native';
import { businessDay, SNAPSHOT_MIN_INTERVAL_MS } from '@daftarak/shared';
import { api } from '../../api/client';
import { getDb } from '../../db/client';
import { getMeta, setMeta } from '../../domain/device';
import { buildSnapshot, snapshotKey } from '../../domain/follow/snapshot';
import { accessToken } from '../../lib/session';
import { useApp } from '../../state/app';

const RECHECK_NONE_MS = 6 * 3_600_000;
const KEEPALIVE_MS = 3_600_000;
const K = { followers: 'follow.followers', noneAt: 'follow.noneAt', pushedAt: 'follow.pushedAt', key: 'follow.key' };

let timer: ReturnType<typeof setTimeout> | null = null;
let busy = false;

/** Cheap 32-bit hash: the stored fingerprint stays tiny. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

export function scheduleSnapshot(delayMs = 60_000) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void pushSnapshot();
  }, delayMs);
}

export async function noteFollowers(n: number) {
  const db = getDb();
  await setMeta(db, K.followers, String(n));
  if (n === 0) await setMeta(db, K.noneAt, String(Date.now()));
  else scheduleSnapshot(5_000);
}

export async function pushSnapshot(force = false): Promise<void> {
  if (busy) return;
  const app = useApp.getState();
  if ((app.status !== 'ready' && app.status !== 'locked') || !app.business?.serverBusinessId || !app.device || app.restoreUnlinked) return;
  busy = true;
  try {
    const db = getDb();
    const now = Date.now();
    const followers = Number((await getMeta(db, K.followers)) ?? -1);
    if (!force && followers === 0 && now - Number((await getMeta(db, K.noneAt)) ?? 0) < RECHECK_NONE_MS) return;
    const last = Number((await getMeta(db, K.pushedAt)) ?? 0);
    if (now - last < SNAPSHOT_MIN_INTERVAL_MS) {
      scheduleSnapshot(SNAPSHOT_MIN_INTERVAL_MS - (now - last) + 2_000);
      return;
    }
    const tz = app.settings.timezone ?? 'Africa/Cairo';
    const snap = await buildSnapshot(db, businessDay(now, tz), app.business.currency, now);
    const key = hash(snapshotKey(snap));
    if (!force && key === (await getMeta(db, K.key)) && now - last < KEEPALIVE_MS) return;
    const r = await api.putSnapshot(await accessToken(), { businessId: app.business.serverBusinessId, deviceId: app.device.id, snapshot: snap });
    await setMeta(db, K.followers, String(r.followers));
    if (r.ok) {
      await setMeta(db, K.pushedAt, String(now));
      await setMeta(db, K.key, key);
    } else await setMeta(db, K.noneAt, String(now));
  } catch {
    /* offline / rate limited: the next change or return to the app tries again */
  } finally {
    busy = false;
  }
}

let watching = false;
/** Opening the app (or coming back to it) sends a fresh summary if one is due. */
export function watchSnapshotTriggers() {
  if (watching) return;
  watching = true;
  AppState.addEventListener('change', (s) => {
    if (s === 'active') scheduleSnapshot(8_000);
  });
}
