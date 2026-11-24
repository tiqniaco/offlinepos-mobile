import { describe, expect, it } from 'vitest';
import {
  computeLicenceState,
  signLicence,
  verifyLicence,
  DAY_MS,
  type LicencePayload,
} from '../src/licence';
import { ed25519GenerateSecretKey, ed25519PublicKey, ed25519Sign, base64urlEncode, utf8ToBytes } from '../src/crypto';
import { DEFAULT_PLANS, defaultUsageLimits, withinLimit } from '../src/plans';

const sk = ed25519GenerateSecretKey();
const pk = ed25519PublicKey(sk);
const keys = { k1: pk };
const NOW = 1_800_000_000_000;
const free = DEFAULT_PLANS.find((p) => p.code === 'free')!;
const pro = DEFAULT_PLANS.find((p) => p.code === 'pro')!;

function payload(over: Partial<LicencePayload> = {}): LicencePayload {
  return {
    v: 1,
    kid: 'k1',
    tid: 'biz-1',
    did: 'dev-1',
    plan: 'pro',
    status: 'active',
    limits: pro.limits,
    features: pro.features,
    fallback: { plan: 'free', limits: free.limits, features: free.features },
    iat: NOW,
    expires_at: NOW + 30 * DAY_MS,
    grace_until: NOW + 37 * DAY_MS,
    refresh_by: NOW + 30 * DAY_MS,
    server_time: NOW,
    ads_enabled: true,
    ...over,
  };
}
const ctx = (now: number, over: Partial<{ deviceId: string; maxSeenTime: number }> = {}) => ({
  now,
  deviceId: 'dev-1',
  maxSeenTime: NOW,
  ...over,
});
const state = (p: LicencePayload, now: number, over = {}) => computeLicenceState(verifyLicence(signLicence(p, sk), keys), ctx(now, over));

describe('licence token', () => {
  it('plans carry the monthly OCR quota (free has none)', () => {
    expect(DEFAULT_PLANS.map((p) => [p.code, p.limits.ocr_month])).toEqual([['free', 0], ['basic', 30], ['pro', 150]]);
  });
  it('an old licence signed before ocr_month existed still verifies and reads OCR as 0', () => {
    const strip = ({ ocr_month: _o, ...rest }: typeof pro.limits) => rest;
    const old = { ...payload(), limits: strip(pro.limits), fallback: { plan: 'free', limits: strip(free.limits), features: [] } };
    const body = base64urlEncode(utf8ToBytes(JSON.stringify(old)));
    const token = `lic1.${body}.${base64urlEncode(ed25519Sign(utf8ToBytes(`lic1.${body}`), sk))}`;
    const v = verifyLicence(token, keys);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.payload.limits.ocr_month).toBe(0);
      expect(v.payload.fallback.limits.ocr_month).toBe(0);
    }
    expect(computeLicenceState(v, ctx(NOW)).limits.ocr_month).toBe(0);
  });
  it('plans carry the usage limits (sms/day, cloud backup MB, receipts/month, requests/day, devices)', () => {
    const pick = (l: (typeof DEFAULT_PLANS)[number]['limits']) => [l.sms_day, l.backup_storage_mb, l.receipt_uploads_month, l.api_requests_day, l.devices];
    expect(DEFAULT_PLANS.map((p) => [p.code, ...pick(p.limits)])).toEqual([
      ['free', 5, 0, 5, 2000, 1],
      ['basic', 10, 50, 10, 5000, 2],
      ['pro', 20, 100, 20, 15000, 5],
    ]);
    expect(defaultUsageLimits('pro', false).backup_storage_mb).toBe(100);
    expect(defaultUsageLimits('gold', false).sms_day).toBe(10); // unknown paid plan → basic
    expect(defaultUsageLimits('promo_free', true).backup_storage_mb).toBe(0);
  });
  it('a licence without the usage limits verifies; a missing limit reads as unlimited', () => {
    const strip = ({ sms_day: _a, backup_storage_mb: _b, receipt_uploads_month: _c, api_requests_day: _d, devices: _e, ...rest }: typeof pro.limits) => rest;
    const old = { ...payload(), limits: strip(pro.limits), fallback: { plan: 'free', limits: strip(free.limits), features: [] } };
    const body = base64urlEncode(utf8ToBytes(JSON.stringify(old)));
    const token = `lic1.${body}.${base64urlEncode(ed25519Sign(utf8ToBytes(`lic1.${body}`), sk))}`;
    const v = verifyLicence(token, keys);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload.limits.backup_storage_mb).toBeUndefined();
    expect(withinLimit(undefined, 1_000_000)).toBe(true);
    expect(withinLimit(0, 0)).toBe(false);
  });
  it('signs and verifies offline', () => {
    const v = verifyLicence(signLicence(payload(), sk), keys);
    expect(v.ok).toBe(true);
  });
  it('rejects a tampered payload', () => {
    const token = signLicence(payload(), sk);
    const [, , sig] = token.split('.');
    const forged = base64urlEncode(utf8ToBytes(JSON.stringify(payload({ plan: 'pro', expires_at: NOW + 999 * DAY_MS }))));
    expect(verifyLicence(`lic1.${forged}.${sig}`, keys)).toEqual({ ok: false, reason: 'signature' });
  });
  it('rejects a token signed by another key', () => {
    const other = ed25519GenerateSecretKey();
    expect(verifyLicence(signLicence(payload(), other), keys)).toEqual({ ok: false, reason: 'signature' });
  });
  it('rejects unknown kid and garbage', () => {
    expect(verifyLicence(signLicence(payload({ kid: 'zz' }), sk), keys)).toEqual({ ok: false, reason: 'unknown_key' });
    expect(verifyLicence('nope', keys).ok).toBe(false);
    expect(verifyLicence('lic1.@@@.###', keys).ok).toBe(false);
  });
});

describe('licence modes', () => {
  it('full while valid; no ads on paid plan', () => {
    const s = state(payload(), NOW + DAY_MS);
    expect(s.mode).toBe('full');
    expect(s.canWrite).toBe(true);
    expect(s.showAds).toBe(false);
  });
  it('trial shows remaining days', () => {
    const s = state(payload({ status: 'trial', expires_at: NOW + 14 * DAY_MS }), NOW + 4 * DAY_MS);
    expect(s.reason).toBe('trial');
    expect(s.trialDaysLeft).toBe(10);
    // Ads are for the free plan only: a trial (pro features) has none.
    expect(s.showAds).toBe(false);
  });
  it('paid plan: 7 days grace after expiry', () => {
    const s = state(payload(), NOW + 33 * DAY_MS, { maxSeenTime: NOW + 33 * DAY_MS });
    // refresh_by passed too in this payload, so give it a later refresh_by:
    const s2 = state(payload({ refresh_by: NOW + 60 * DAY_MS }), NOW + 33 * DAY_MS);
    expect(s.mode).toBe('read_only'); // offline too long wins
    expect(s2.mode).toBe('grace');
    expect(s2.graceDaysLeft).toBe(4);
  });
  it('after grace → free plan with free limits and ads (D-20)', () => {
    const s = state(payload({ refresh_by: NOW + 60 * DAY_MS }), NOW + 40 * DAY_MS);
    expect(s.mode).toBe('free');
    expect(s.canWrite).toBe(true);
    expect(s.limits).toEqual(free.limits);
    expect(s.showAds).toBe(true);
  });
  it('trial end → free immediately (no grace)', () => {
    const s = state(payload({ status: 'trial', expires_at: NOW + 14 * DAY_MS, refresh_by: NOW + 60 * DAY_MS }), NOW + 15 * DAY_MS);
    expect(s.mode).toBe('free');
  });
  it('global ads switch off hides ads even on free', () => {
    const s = state(payload({ refresh_by: NOW + 60 * DAY_MS, ads_enabled: false }), NOW + 40 * DAY_MS);
    expect(s.showAds).toBe(false);
  });
  it('no check-in for more than 30 days → read-only', () => {
    const s = state(payload(), NOW + 31 * DAY_MS);
    expect(s.mode).toBe('read_only');
    expect(s.reason).toBe('offline_too_long');
    expect(s.canWrite).toBe(false);
  });
  it('wrong device → read-only', () => {
    expect(state(payload(), NOW, { deviceId: 'other' }).reason).toBe('wrong_device');
  });
  it('deactivated / suspended → read-only', () => {
    expect(state(payload({ status: 'deactivated' }), NOW).mode).toBe('read_only');
    expect(state(payload({ status: 'suspended' }), NOW).mode).toBe('read_only');
  });
  it('clock moved back more than 24h → needs check-in, no writing', () => {
    const s = state(payload(), NOW - 25 * 3_600_000);
    expect(s.mode).toBe('needs_checkin');
    expect(s.canWrite).toBe(false);
  });
  it('clock moved back less than 24h is tolerated', () => {
    expect(state(payload(), NOW - 23 * 3_600_000).mode).toBe('full');
  });
  it('rollback is measured against the max time ever seen, not only the token', () => {
    const s = state(payload({ refresh_by: NOW + 60 * DAY_MS }), NOW + 5 * DAY_MS, { maxSeenTime: NOW + 10 * DAY_MS });
    expect(s.mode).toBe('needs_checkin');
  });
  it('missing or invalid licence → read-only', () => {
    expect(computeLicenceState(null, ctx(NOW)).mode).toBe('read_only');
    expect(computeLicenceState({ ok: false, reason: 'signature' }, ctx(NOW)).reason).toBe('invalid');
  });
});
