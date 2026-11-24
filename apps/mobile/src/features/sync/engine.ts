/**
 * Multi-user on one shop — the network side.
 *  Main phone:    pulls the cashier phones' sales, posts them (domain/sync/apply), acks; uploads the catalog when
 *                 it changed. Only while the shop has cashier phones (learned at check-in / from «موبايلات المحل»).
 *  Cashier phone: pushes its queued sales, learns which ones the main phone applied, downloads a newer catalog.
 * Runs a few seconds after a change, when the app comes back, and every minute or two while it is open.
 * Offline is normal: everything waits and retries; a sale is never lost (it stays in sync_outbox until applied).
 */
import { AppState } from 'react-native';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { create } from 'zustand';
import { base64urlDecode, base64urlEncode, catalogAad, newSyncKey, openSync, opAad, sealSync } from '@daftarak/shared';
import { api, ApiError } from '../../api/client';
import { getDb } from '../../db/client';
import { syncApplied, syncOutbox } from '../../db/schema';
import { getMeta, setMeta } from '../../domain/device';
import { applyOp, recordFailure } from '../../domain/sync/apply';
import { buildCatalog, catalogKey, installCatalog, type Catalog } from '../../domain/sync/catalog';
import { isCashierPhone, setCashierStopped } from '../../domain/sync/role';
import { accessToken } from '../../lib/session';
import { bumpData, useApp } from '../../state/app';

const K = { key: 'sync.key', cashiers: 'sync.cashiers', catKey: 'sync.catKey', catVersion: 'sync.catalogVersion', stopped: 'sync.stopped' };
const ENDED = new Set(['device_deactivated', 'session_revoked', 'wrong_device_role']);

export const useSync = create<{ pending: number; lastOkAt: number | null; stopped: boolean; failed: number; cashiers: number; set: (p: Partial<{ pending: number; lastOkAt: number | null; stopped: boolean; failed: number; cashiers: number }>) => void }>((set) => ({
  pending: 0,
  lastOkAt: null,
  stopped: false,
  failed: 0,
  cashiers: 0,
  set: (p) => set(p),
}));

export async function getSyncKey(): Promise<string | null> {
  return getMeta(getDb(), K.key);
}
/** Main phone: the shop's sync key (made once, kept in the encrypted DB so backups carry it). */
export async function ensureSyncKey(): Promise<string> {
  const db = getDb();
  const k = await getMeta(db, K.key);
  if (k) return k;
  const n = newSyncKey();
  await setMeta(db, K.key, n);
  return n;
}

export async function noteCashiers(n: number) {
  await setMeta(getDb(), K.cashiers, String(n));
  useSync.getState().set({ cashiers: n });
  if (n > 0) scheduleSync(3_000);
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function scheduleSync(delayMs = 5_000) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void runSync();
  }, delayMs);
}

export async function runSync(force = false): Promise<void> {
  if (running) return;
  const app = useApp.getState();
  if ((app.status !== 'ready' && app.status !== 'locked') || !app.business?.serverBusinessId || !app.device || app.restoreUnlinked) return;
  running = true;
  try {
    if (isCashierPhone()) await cashierSync(app.business.serverBusinessId, app.device.id);
    else await mainSync(app.business.serverBusinessId, app.device.id, app.settings.timezone ?? 'Africa/Cairo', force);
  } catch (e) {
    if (e instanceof ApiError && ENDED.has(e.code) && isCashierPhone()) {
      await setMeta(getDb(), K.stopped, '1');
      setCashierStopped(true);
      useSync.getState().set({ stopped: true });
    }
  } finally {
    running = false;
    await refreshCounts().catch(() => undefined);
  }
}

async function refreshCounts() {
  const db = getDb();
  if (isCashierPhone()) {
    const n = Number((await db.select({ n: sql<number>`count(*)` }).from(syncOutbox).where(isNull(syncOutbox.appliedAt)))[0]?.n ?? 0);
    useSync.getState().set({ pending: n, stopped: (await getMeta(db, K.stopped)) === '1' });
  } else {
    const f = Number((await db.select({ n: sql<number>`count(*)` }).from(syncApplied).where(sql`${syncApplied.error} IS NOT NULL`))[0]?.n ?? 0);
    useSync.getState().set({ failed: f, cashiers: Number((await getMeta(db, K.cashiers)) ?? 0) });
  }
}

async function mainSync(businessId: string, deviceId: string, timezone: string, force: boolean) {
  const db = getDb();
  const cashiers = Number((await getMeta(db, K.cashiers)) ?? 0);
  if (!force && cashiers <= 0) return;
  const key = await ensureSyncKey();
  const token = await accessToken();
  // 1) Sales from the cashier phones.
  let applied = 0;
  for (let page = 0; page < 5; page++) {
    const r = await api.syncPullOps(token, businessId, deviceId);
    if (!r.ops.length) break;
    const features = useApp.getState().licence?.features ?? [];
    const ack: number[] = [];
    for (const op of r.ops) {
      let payload: { kind?: string } & Record<string, unknown>;
      try {
        payload = openSync(key, base64urlDecode(op.data), opAad(businessId, op.deviceId, op.seq));
      } catch {
        // Never acked: kept on the server (and on the cashier phone) until it can be read.
        await recordFailure(db, `${op.deviceId}:${op.seq}`, 'unreadable');
        continue;
      }
      const res = await applyOp(db, { deviceId: op.deviceId, deviceCode: op.deviceCode, seq: op.seq, kind: String(payload.kind ?? 'sale'), payload: payload.body ?? payload }, { timezone, features: features as never });
      if (res === 'applied') applied++;
      // A sale that could not be posted is not acked: retried next time, never lost.
      if (res !== 'failed') ack.push(op.id);
    }
    if (ack.length) await api.syncAckOps(token, businessId, deviceId, ack);
    if (!r.more || !ack.length) break;
  }
  if (applied) bumpData();
  // 2) Catalog for the cashier phones, when it changed.
  const cat = await buildCatalog(db);
  const k = catalogKey(cat);
  if (force || k !== (await getMeta(db, K.catKey))) {
    const res = await api.syncPutCatalog(token, businessId, deviceId, sealSync(key, cat, catalogAad(businessId)));
    await setMeta(db, K.catKey, k);
    await setMeta(db, K.cashiers, String(res.satellites));
  }
  useSync.getState().set({ lastOkAt: Date.now() });
}

async function cashierSync(businessId: string, deviceId: string) {
  const db = getDb();
  const key = await getSyncKey();
  if (!key) return;
  const token = await accessToken();
  // 1) Push the queued sales (oldest first, 50 at a time).
  for (let i = 0; i < 10; i++) {
    const rows = await db.select().from(syncOutbox).where(isNull(syncOutbox.appliedAt)).orderBy(asc(syncOutbox.seq)).limit(50);
    const toSend = rows.filter((r) => !r.pushedAt);
    if (!toSend.length) break;
    const ops = toSend.map((r) => ({ seq: r.seq, data: base64urlEncode(sealSync(key, { kind: r.kind, body: JSON.parse(r.payload) }, opAad(businessId, deviceId, r.seq))) }));
    const res = await api.syncPushOps(token, deviceId, ops);
    const now = Date.now();
    for (const r of toSend) await db.update(syncOutbox).set({ pushedAt: now }).where(eq(syncOutbox.seq, r.seq));
    await markApplied(res.appliedSeq);
    if (toSend.length < 50) break;
  }
  // 2) What the main phone applied, and a newer catalog.
  const st = await api.syncStatus(token, deviceId);
  await markApplied(st.appliedSeq);
  if (st.stopped) {
    // Removed by the owner: deliver what was sold, sell no more.
    await setMeta(db, K.stopped, '1');
    setCashierStopped(true);
    useSync.getState().set({ stopped: true, lastOkAt: Date.now() });
    return;
  }
  // Pushed long ago but still not applied (main phone offline, or a lost answer): send again later (idempotent by seq).
  await db.update(syncOutbox).set({ pushedAt: null }).where(and(isNull(syncOutbox.appliedAt), lte(syncOutbox.pushedAt, Date.now() - 30 * 60_000)));
  if (st.catalogVersion > Number((await getMeta(db, K.catVersion)) ?? 0)) {
    const { version, blob } = await api.syncGetCatalog(token, deviceId);
    const cat = openSync<Catalog>(key, blob, catalogAad(businessId));
    await installCatalog(db, cat, deviceId);
    await setMeta(db, K.catVersion, String(version));
    bumpData();
    const { reloadAppData } = await import('../../state/boot');
    await reloadAppData();
  }
  useSync.getState().set({ lastOkAt: Date.now() });
}

async function markApplied(upTo: number) {
  if (upTo > 0) await getDb().update(syncOutbox).set({ appliedAt: Date.now() }).where(and(isNull(syncOutbox.appliedAt), lte(syncOutbox.seq, upTo)));
}

let watching = false;
/** Boot: periodic sync while the app is open, and right after coming back. */
export function watchSync() {
  if (watching) return;
  watching = true;
  AppState.addEventListener('change', (s) => {
    if (s === 'active') scheduleSync(4_000);
  });
  setInterval(() => {
    if (AppState.currentState === 'active') scheduleSync(0);
  }, isCashierPhone() ? 60_000 : 120_000);
  void refreshCounts().catch(() => undefined);
  scheduleSync(6_000);
}
