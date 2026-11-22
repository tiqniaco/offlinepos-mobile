import { DAY_MS, DEFAULT_PLANS, ed25519GenerateSecretKey, ed25519PublicKey, signLicence, type LicencePayload } from '@daftarak/shared';

const mockSk = ed25519GenerateSecretKey();
const sk = mockSk;
// Getter: evaluated lazily at verify time (jest hoists mocks above the key generation).
jest.mock('../../config/licenceKeys', () => ({
  get LICENCE_PUBLIC_KEYS() {
    return { t: require('@daftarak/shared').ed25519PublicKey(mockSk) };
  },
}));
// eslint-disable-next-line import/first
import { assertCanWrite, assertWithinLimit, evaluateLicence, LicenceError, setLicenceState } from './guard';

const NOW = 1_800_000_000_000;
const free = DEFAULT_PLANS[0]!;
const pro = DEFAULT_PLANS[2]!;
const payload = (o: Partial<LicencePayload> = {}): LicencePayload => ({
  v: 1, kid: 't', tid: 'b', did: 'd', plan: 'pro', status: 'trial', limits: pro.limits, features: pro.features,
  fallback: { plan: 'free', limits: free.limits, features: free.features },
  iat: NOW, expires_at: NOW + 14 * DAY_MS, grace_until: NOW + 21 * DAY_MS, refresh_by: NOW + 30 * DAY_MS, server_time: NOW, ads_enabled: true, ...o,
});
const ctx = (now = NOW) => ({ now, deviceId: 'd', maxSeenTime: NOW });

describe('licence guard', () => {
  it('allows writing with a valid trial', () => {
    setLicenceState(evaluateLicence(signLicence(payload(), sk), ctx()));
    expect(() => assertCanWrite()).not.toThrow();
  });
  it('blocks writing when the licence is missing or expired beyond the 30-day check-in (read-only)', () => {
    setLicenceState(evaluateLicence(null, ctx()));
    expect(() => assertCanWrite()).toThrow(LicenceError);
    setLicenceState(evaluateLicence(signLicence(payload(), sk), ctx(NOW + 31 * DAY_MS)));
    expect(() => assertCanWrite()).toThrow(LicenceError);
  });
  it('blocks writing after a clock rollback', () => {
    setLicenceState(evaluateLicence(signLicence(payload(), sk), ctx(NOW - 2 * DAY_MS)));
    expect(() => assertCanWrite()).toThrow('clock_rollback');
  });
  it('enforces plan limits on the free fallback', () => {
    setLicenceState(evaluateLicence(signLicence(payload(), sk), ctx(NOW + 15 * DAY_MS)));
    expect(() => assertWithinLimit('users', 0)).not.toThrow();
    expect(() => assertWithinLimit('users', 1)).toThrow(LicenceError);
  });
  it('rejects a licence signed with an unknown key', () => {
    const other = ed25519GenerateSecretKey();
    expect(ed25519PublicKey(other)).not.toBe(ed25519PublicKey(sk));
    setLicenceState(evaluateLicence(signLicence(payload(), other), ctx()));
    expect(() => assertCanWrite()).toThrow('invalid');
  });
});
