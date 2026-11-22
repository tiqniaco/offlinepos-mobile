/**
 * Licence persistence, clock guard and the daily check-in (PLAN.md §8, D-02).
 * max_seen_time is kept in BOTH the DB and SecureStore — both must be wiped to reset it.
 */
import { eq } from 'drizzle-orm';
import { CLOCK_TOLERANCE_MS, bumpMaxSeen, type LicenceState } from '@daftarak/shared';
import type { AppDb } from '../../db/client';
import { licenceState } from '../../db/schema';
import { SECURE_KEYS, deleteSecret, getSecret, setSecret } from '../../lib/secure';
import { api, ApiError } from '../../api/client';
import { APP_VERSION } from '../../config/env';
import { getCurrentDevice } from '../device';
import { evaluateLicence, setLicenceState } from './guard';

const ROW_ID = 1;

async function readRow(db: AppDb) {
  return (await db.select().from(licenceState).where(eq(licenceState.id, ROW_ID)).limit(1))[0] ?? null;
}

async function readMaxSeen(db: AppDb): Promise<number> {
  const row = await readRow(db);
  const secure = Number((await getSecret(SECURE_KEYS.maxSeenTime)) ?? 0);
  return Math.max(row?.maxSeenTime ?? 0, Number.isFinite(secure) ? secure : 0);
}

async function writeMaxSeen(db: AppDb, value: number) {
  await db.update(licenceState).set({ maxSeenTime: value, updatedAt: Date.now() }).where(eq(licenceState.id, ROW_ID));
  await setSecret(SECURE_KEYS.maxSeenTime, String(value));
}

/** Saves a licence that came from the server. Server time becomes the new trusted time. */
export async function storeLicence(db: AppDb, token: string, serverTime: number) {
  const now = Date.now();
  const existing = await readRow(db);
  if (existing) {
    await db.update(licenceState).set({ token, lastCheckinAt: now, lastServerTime: serverTime, maxSeenTime: serverTime, updatedAt: now }).where(eq(licenceState.id, ROW_ID));
  } else {
    await db.insert(licenceState).values({ id: ROW_ID, token, lastCheckinAt: now, lastServerTime: serverTime, maxSeenTime: serverTime, updatedAt: now });
  }
  await setSecret(SECURE_KEYS.maxSeenTime, String(serverTime));
}

/** Evaluate the stored licence for "now" and publish it to the guard. Cheap, offline. */
export async function refreshLicenceState(db: AppDb, now = Date.now()): Promise<LicenceState> {
  const device = await getCurrentDevice(db);
  const row = await readRow(db);
  const maxSeen = await readMaxSeen(db);
  const state = evaluateLicence(row?.token ?? null, { now, deviceId: device?.id ?? '', maxSeenTime: maxSeen });
  // Only move the trusted clock forward when the device clock looks sane.
  if (row && now >= maxSeen - CLOCK_TOLERANCE_MS) {
    const next = bumpMaxSeen(maxSeen, now);
    if (next !== maxSeen) await writeMaxSeen(db, next);
  }
  setLicenceState(state);
  return state;
}

export type CheckinOutcome = 'ok' | 'offline' | 'signed_out' | 'error' | 'not_registered';

const CHECKIN_EVERY_MS = 20 * 3_600_000;

export async function checkinDue(db: AppDb, now = Date.now()): Promise<boolean> {
  const row = await readRow(db);
  return !row?.lastCheckinAt || now - row.lastCheckinAt > CHECKIN_EVERY_MS || now < row.lastCheckinAt;
}

/** The one daily call. Safe to call anytime; failure never blocks daily work. */
export async function runCheckin(db: AppDb): Promise<{ outcome: CheckinOutcome; state: LicenceState; notices: { textAr: string; textEn: string }[] }> {
  const device = await getCurrentDevice(db);
  const refreshToken = await getSecret(SECURE_KEYS.refreshToken);
  if (!device || !refreshToken) return { outcome: device ? 'signed_out' : 'not_registered', state: await refreshLicenceState(db), notices: [] };
  try {
    const r = await api.checkin({ refreshToken, deviceId: device.id, appVersion: APP_VERSION, deviceTime: Date.now() });
    await setSecret(SECURE_KEYS.refreshToken, r.refreshToken);
    await storeLicence(db, r.licence, r.serverTime);
    return { outcome: 'ok', state: await refreshLicenceState(db), notices: r.notices };
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'session_revoked' || e.code === 'unauthorized')) {
      // Remote revoke takes effect now: drop the session and the licence → read-only until OTP login.
      await deleteSecret(SECURE_KEYS.refreshToken);
      await db.update(licenceState).set({ token: null, updatedAt: Date.now() }).where(eq(licenceState.id, ROW_ID));
      return { outcome: 'signed_out', state: await refreshLicenceState(db), notices: [] };
    }
    const outcome: CheckinOutcome = e instanceof ApiError && e.code === 'network' ? 'offline' : 'error';
    return { outcome, state: await refreshLicenceState(db), notices: [] };
  }
}
