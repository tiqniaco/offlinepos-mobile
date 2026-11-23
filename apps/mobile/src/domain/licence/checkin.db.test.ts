/** Client side of the session / licence: a dropped session keeps the signed licence; a bad token never replaces a good one. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLANS, ed25519PublicKey, signLicence, type LicencePayload } from '@daftarak/shared';

const SK = '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60';
const secrets = new Map<string, string>();
const checkin = vi.fn();

vi.mock('../../config/licenceKeys', () => ({ LICENCE_PUBLIC_KEYS: { test: ed25519PublicKey(SK) } }));
vi.mock('../../config/env', () => ({ APP_VERSION: '1.0.0', API_URL: 'http://x' }));
vi.mock('../../lib/secure', () => ({
  SECURE_KEYS: { refreshToken: 'rt', maxSeenTime: 'ms' },
  getSecret: async (k: string) => secrets.get(k) ?? null,
  setSecret: async (k: string, v: string) => void secrets.set(k, v),
  deleteSecret: async (k: string) => void secrets.delete(k),
}));
vi.mock('../../lib/session', () => ({ useAccessToken: () => undefined, withRefreshLock: <T,>(fn: () => Promise<T>) => fn() }));
vi.mock('../integrity/anchors', () => ({ currentAnchor: async () => undefined, saveReceipt: async () => undefined }));
vi.mock('../inbox/inbox', () => ({ saveAnnouncements: async () => [] }));
vi.mock('../../api/client', () => {
  class ApiError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return { ApiError, api: { checkin: (...a: unknown[]) => checkin(...a) } };
});

const { createTestDb } = await import('../../test/testDb');
const { setMeta } = await import('../device');
const { runCheckin, storeLicence, sessionSignedOut, reauthenticate } = await import('./service');
const { ApiError } = await import('../../api/client');

const now = Date.now();
const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;
const free = DEFAULT_PLANS.find((p) => p.code === 'free')!;
const lic = (did: string, plan = 'pro') => {
  const payload: LicencePayload = {
    v: 1, kid: 'test', tid: 'biz', did, plan, status: 'active', limits: pro.limits, features: pro.features,
    fallback: { plan: 'free', limits: free.limits, features: [] },
    iat: now, expires_at: now + 30 * 86_400_000, grace_until: now + 37 * 86_400_000, refresh_by: now + 30 * 86_400_000, server_time: now, ads_enabled: true,
  };
  return signLicence(payload, SK);
};

async function setup() {
  const db = createTestDb();
  await setMeta(db, 'device_id', 'dev-1');
  await setMeta(db, 'device_code', 'A');
  expect(await storeLicence(db, lic('dev-1'), now)).toBe(true);
  secrets.set('rt', 'sid.secret');
  return db;
}

describe('licence service (client)', () => {
  beforeEach(() => {
    secrets.clear();
    checkin.mockReset();
  });

  it('session revoked → refresh token dropped, licence KEPT (still full), "sign in again" flagged', async () => {
    const db = await setup();
    checkin.mockRejectedValueOnce(new ApiError('session_revoked', 'gone'));
    const r = await runCheckin(db);
    expect(r.outcome).toBe('signed_out');
    expect(r.state.mode).toBe('full');
    expect(secrets.has('rt')).toBe(false);
    expect(sessionSignedOut()).toBe(true);
    // Sign in again (same account owns this shop: no local business row in this test) → check-in runs, flag clears.
    checkin.mockResolvedValueOnce({ licence: lic('dev-1'), serverTime: now, refreshToken: 'sid.next', accessToken: 'a', accessExpiresAt: now + 1, anchorReceipt: null, notices: [] });
    const again = await reauthenticate(db, { refreshToken: 'sid.new', accessToken: 'a', accessExpiresAt: now + 1, businesses: [] });
    expect(again.outcome).toBe('ok');
    expect(sessionSignedOut()).toBe(false);
    expect(secrets.get('rt')).toBe('sid.next');
  });

  it('an unverifiable licence from the server never replaces the good one', async () => {
    const db = await setup();
    expect(await storeLicence(db, 'lic1.garbage.sig', now)).toBe(false);
    checkin.mockResolvedValueOnce({ licence: 'lic1.bad.bad', serverTime: now, refreshToken: 'sid.next', accessToken: 'a', accessExpiresAt: now + 1, anchorReceipt: null, notices: [] });
    const r = await runCheckin(db);
    expect(r.outcome).toBe('ok');
    expect(r.state.mode).toBe('full');
  });
});
