/**
 * Licence persistence, clock guard and the daily check-in (PLAN.md §8, D-02).
 * max_seen_time is kept in BOTH the DB and SecureStore — both must be wiped to reset it.
 */
import { eq } from 'drizzle-orm';
import { CLOCK_TOLERANCE_MS, bumpMaxSeen, verifyLicence, type LicenceState } from '@daftarak/shared';
import { LICENCE_PUBLIC_KEYS } from '../../config/licenceKeys';
import type { Db as AppDb } from '../../db/types';
import { business as businessTable, licenceState } from '../../db/schema';
import { SECURE_KEYS, deleteSecret, getSecret, setSecret } from '../../lib/secure';
import type { AuthResponse } from '@daftarak/shared';
import { api, ApiError } from '../../api/client';
import { APP_VERSION } from '../../config/env';
import { getCurrentDevice, getMeta, setMeta } from '../device';
import { saveAnnouncements, type Announcement } from '../inbox/inbox';
import { evaluateLicence, setLicenceState } from './guard';
import { currentAnchor, saveReceipt } from '../integrity/anchors';
import { useAccessToken, withRefreshLock } from '../../lib/session';

/** Backup hooks (set by the app layer; the domain stays free of file-system code). */
export const hooks: {
  prepareBackup?: () => Promise<{ size: number; sha256: string; counts: Record<string, number>; schemaVersion: number } | undefined>;
  pendingBackupId?: () => Promise<string | undefined>;
  /** Weekly device-integrity token (Play Integrity / App Attest). */
  integrity?: () => Promise<{ platform: 'android' | 'ios'; token: string; requestHash: string; keyId?: string } | undefined>;
  /** Expo push token of this phone, if notifications are allowed. */
  pushToken?: () => Promise<string | undefined>;
  /** New messages from Daftarak arrived with the check-in (already stored in the inbox). */
  onAnnouncements?: (fresh: Announcement[]) => Promise<void>;
  /** Follower phones of the shop («موبايل متابعة»), reported by every check-in. */
  onFollowers?: (n: number) => Promise<void>;
  afterCheckin?: (put: { backupId: string; url: string; headers: Record<string, string> } | null, committed: boolean | undefined, backupError?: string) => Promise<void>;
} = {};

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

/**
 * "Signed out" = the server no longer accepts this phone's session (revoked / expired). The signed licence is KEPT
 * (it stays valid offline until it expires); the UI offers "sign in again" (reauthenticate).
 */
let signedOut = false;
const sessionListeners = new Set<() => void>();
export const sessionSignedOut = () => signedOut;
export function onSessionChange(l: () => void): () => void {
  sessionListeners.add(l);
  return () => sessionListeners.delete(l);
}
function setSignedOut(v: boolean) {
  if (signedOut === v) return;
  signedOut = v;
  sessionListeners.forEach((l) => l());
}

/**
 * Saves a licence that came from the server. Server time becomes the new trusted time.
 * The new token is verified first: an unverifiable one (e.g. a server key mix-up) never replaces a good licence.
 * Returns false when the token was rejected.
 */
export async function storeLicence(db: AppDb, token: string, serverTime: number): Promise<boolean> {
  if (!verifyLicence(token, LICENCE_PUBLIC_KEYS).ok) return false;
  const now = Date.now();
  const existing = await readRow(db);
  if (existing) {
    await db.update(licenceState).set({ token, lastCheckinAt: now, lastServerTime: serverTime, maxSeenTime: serverTime, updatedAt: now }).where(eq(licenceState.id, ROW_ID));
  } else {
    await db.insert(licenceState).values({ id: ROW_ID, token, lastCheckinAt: now, lastServerTime: serverTime, maxSeenTime: serverTime, updatedAt: now });
  }
  await setSecret(SECURE_KEYS.maxSeenTime, String(serverTime));
  return true;
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
  if (device && !refreshToken) setSignedOut(true);
  if (!device || !refreshToken) return { outcome: device ? 'signed_out' : 'not_registered', state: await refreshLicenceState(db), notices: [] };
  try {
    // Anchor today's chain heads + carry the automatic backup on the SAME request (budget: 1 call/day).
    const anchor = await currentAnchor(db, device.id);
    const backupMeta = hooks.prepareBackup ? await hooks.prepareBackup() : undefined;
    const committedBackupId = hooks.pendingBackupId ? await hooks.pendingBackupId() : undefined;
    const integrity = hooks.integrity ? await hooks.integrity() : undefined;
    // Push token only when it changed (keeps the request small).
    const tok = hooks.pushToken ? await hooks.pushToken().catch(() => undefined) : undefined;
    const pushToken = tok && tok !== (await getMeta(db, 'push.sent')) ? tok : undefined;
    const r = await withRefreshLock(async () => {
      const token = (await getSecret(SECURE_KEYS.refreshToken)) ?? refreshToken;
      const res = await api.checkin({ refreshToken: token, deviceId: device.id, appVersion: APP_VERSION, deviceTime: Date.now(), anchor, backupMeta, committedBackupId, integrity, pushToken });
      await setSecret(SECURE_KEYS.refreshToken, res.refreshToken);
      return res;
    });
    useAccessToken(r.accessToken, r.accessExpiresAt);
    setSignedOut(false);
    await storeLicence(db, r.licence, r.serverTime);
    if (r.anchorReceipt) await saveReceipt(db, device.id, r.anchorReceipt);
    if (pushToken) await setMeta(db, 'push.sent', pushToken);
    if (r.announcements?.length) {
      const fresh = await saveAnnouncements(db, r.announcements);
      if (fresh.length) await hooks.onAnnouncements?.(fresh).catch(() => undefined);
    }
    if (r.followers != null) await hooks.onFollowers?.(r.followers).catch(() => undefined);
    await hooks.afterCheckin?.(r.backupPut ?? null, r.backupCommitted, r.backupError);
    return { outcome: 'ok', state: await refreshLicenceState(db), notices: r.notices };
  } catch (e) {
    if (e instanceof ApiError && (e.code === 'session_revoked' || e.code === 'unauthorized')) {
      // The session is gone: drop the refresh token but KEEP the signed licence. The shop keeps working offline
      // until the licence's own dates run out (a lost response must never make a paying shop read-only);
      // the app shows "sign in again".
      await deleteSecret(SECURE_KEYS.refreshToken);
      setSignedOut(true);
      return { outcome: 'signed_out', state: await refreshLicenceState(db), notices: [] };
    }
    const outcome: CheckinOutcome = e instanceof ApiError && e.code === 'network' ? 'offline' : 'error';
    return { outcome, state: await refreshLicenceState(db), notices: [] };
  }
}

/**
 * "Sign in again" after signed_out: a fresh login (OTP or password) for the SAME account; this phone keeps its
 * device registration (no new device code), then the check-in brings a new licence.
 */
export async function reauthenticate(db: AppDb, auth: Pick<AuthResponse, 'refreshToken' | 'accessToken' | 'accessExpiresAt' | 'businesses'>) {
  const b = (await db.select().from(businessTable).limit(1))[0];
  if (b && !auth.businesses.some((x) => x.id === b.serverBusinessId)) throw new ApiError('not_found', 'this account does not own this shop');
  await withRefreshLock(() => setSecret(SECURE_KEYS.refreshToken, auth.refreshToken));
  useAccessToken(auth.accessToken, auth.accessExpiresAt);
  setSignedOut(false);
  return runCheckin(db);
}
