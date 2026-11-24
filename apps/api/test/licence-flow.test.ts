import { cairoDay } from '../src/usage/meter';
import { describe, expect, it } from 'vitest';
import { computeLicenceState, ed25519PublicKey, verifyLicence, DAY_MS, canonicalJson, utf8ToBytes, ed25519Verify, base64urlDecode } from '@daftarak/shared';
import { makeClient, login, device, stepUp, BACKUP_KEY, TEST_PK_SK } from './helpers';

const keys = { '2026-01': ed25519PublicKey(TEST_PK_SK) };
const H = 'a'.repeat(64);

async function onboard(c: ReturnType<typeof makeClient>, phone: string) {
  const auth = await login(c, phone);
  const r = await c.call(
    'POST',
    '/v1/businesses',
    { name: 'بقالة النور', country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device() },
    { Authorization: `Bearer ${auth.accessToken}` },
  );
  expect(r.status).toBe(201);
  return { auth, reg: r.json.registration, business: r.json.business };
}

describe('sign-up → licence', () => {
  it('creates a business with a 14-day Pro trial and device code A; licence verifies offline', async () => {
    const c = makeClient();
    const { reg } = await onboard(c, '01033333331');
    expect(reg.deviceCode).toBe('A');
    const v = verifyLicence(reg.licence, keys);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.payload.status).toBe('trial');
    expect(v.payload.plan).toBe('pro');
    expect(v.payload.expires_at - c.clock.now).toBe(14 * DAY_MS);
    expect(v.payload.did).toBe(reg.deviceId);
    const s = computeLicenceState(v, { now: c.clock.now, deviceId: reg.deviceId, maxSeenTime: c.clock.now });
    expect(s.mode).toBe('full');
    expect(s.trialDaysLeft).toBe(14);
    expect(s.showAds).toBe(false);
  });

  it('backup key is stored wrapped, never in clear', async () => {
    const c = makeClient();
    const { business } = await onboard(c, '01033333332');
    const row = await c.env.DB.prepare('SELECT backup_key_wrapped FROM businesses WHERE id = ?1').bind(business.id).first<any>();
    expect(row.backup_key_wrapped).not.toContain(BACKUP_KEY);
  });
});

describe('daily check-in', () => {
  it('rotates the refresh token, returns licence and a signed anchor receipt, counts 1 request', async () => {
    const c = makeClient();
    const { auth, reg } = await onboard(c, '01033333333');
    c.advance(DAY_MS);
    const anchor = { chainSeq: 10, chainHead: H, auditSeq: 3, auditHead: H };
    const r = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, anchor });
    expect(r.status).toBe(200);
    expect(r.json.refreshToken).not.toBe(auth.refreshToken);
    expect(verifyLicence(r.json.licence, keys).ok).toBe(true);
    const msg = utf8ToBytes(canonicalJson({ t: 'anchor', deviceId: reg.deviceId, ...anchor, serverTime: r.json.serverTime }));
    expect(ed25519Verify(base64urlDecode(r.json.anchorReceipt.sig), msg, keys['2026-01'])).toBe(true);
    const cnt = await c.env.DB.prepare(`SELECT count FROM usage_daily WHERE day = ?1 AND metric = 'api_requests' AND business_id != '*'`).bind(cairoDay(c.clock.now)).first<any>();
    expect(cnt.count).toBe(1);
  });

  it('re-using an old refresh token after the grace window revokes the session', async () => {
    const c = makeClient();
    const { auth, reg } = await onboard(c, '01033333334');
    const first = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(first.status).toBe(200);
    c.advance(3 * 60_000);
    const reuse = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(reuse.json.error.code).toBe('session_revoked');
    const after = await c.call('POST', '/v1/checkin', { refreshToken: first.json.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(after.json.error.code).toBe('session_revoked');
  });

  it('a lost check-in response: the retry with the previous token is accepted once within 2 minutes', async () => {
    const c = makeClient();
    const { auth, reg } = await onboard(c, '01033333344');
    const body = (refreshToken: string) => ({ refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const lost = await c.call('POST', '/v1/checkin', body(auth.refreshToken));
    expect(lost.status).toBe(200);
    c.advance(30_000);
    const retry = await c.call('POST', '/v1/checkin', body(auth.refreshToken));
    expect(retry.status).toBe(200);
    expect(retry.json.refreshToken).not.toBe(lost.json.refreshToken);
    // The undelivered token is dead (replaced), the delivered one works.
    expect((await c.call('POST', '/v1/checkin', body(lost.json.refreshToken))).status).toBe(401);
    // A second grace use of the same old token is theft.
    const again = await c.call('POST', '/v1/checkin', body(auth.refreshToken));
    expect(again.json.error.code).toBe('session_revoked');
  });

  it('the refresh token is rotated only after the check-in work succeeded', async () => {
    const c = makeClient();
    const { auth } = await onboard(c, '01033333345');
    // Unknown device → 404, and the presented token is still the current one.
    const bad = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: 'nope', appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(bad.status).toBe(404);
    const r = await c.call('POST', '/v1/auth/refresh', { refreshToken: auth.refreshToken });
    expect(r.status).toBe(200);
  });

  it('remote session revoke takes effect at the next check-in', async () => {
    const c = makeClient();
    const { auth, reg } = await onboard(c, '01033333335');
    c.advance(61_000);
    const other = await login(c, '01033333335', 'install-0002');
    const list = await c.call('GET', '/v1/sessions', undefined, { Authorization: `Bearer ${other.accessToken}` });
    const target = list.json.sessions.find((s: any) => !s.current);
    expect((await c.call('DELETE', `/v1/sessions/${target.id}`, undefined, { Authorization: `Bearer ${other.accessToken}` })).status).toBe(200);
    const r = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r.json.error.code).toBe('session_revoked');
  });

  it('attaching a new phone deactivates the old one → old licence becomes read-only', async () => {
    const c = makeClient();
    const { auth, reg, business } = await onboard(c, '01033333336');
    c.advance(61_000);
    const auth2 = await login(c, '01033333336', 'install-0003');
    // The shop is active on another phone: attaching needs a fresh SMS step-up.
    const noStep = await c.call('POST', '/v1/devices/attach', { businessId: business.id, device: device('install-0003') }, { Authorization: `Bearer ${auth2.accessToken}` });
    expect([noStep.status, noStep.json.error.code]).toEqual([403, 'step_up_required']);
    c.advance(61_000);
    await stepUp(c, auth2.accessToken, '201033333336');
    const a = await c.call('POST', '/v1/devices/attach', { businessId: business.id, device: device('install-0003') }, { Authorization: `Bearer ${auth2.accessToken}` });
    expect(a.json.registration.deviceCode).toBe('B');
    const r = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const v = verifyLicence(r.json.licence, keys);
    expect(v.ok && v.payload.status).toBe('deactivated');
    expect(computeLicenceState(v, { now: c.clock.now, deviceId: reg.deviceId, maxSeenTime: 0 }).mode).toBe('read_only');
  });

  it('cannot check in for a device of another account', async () => {
    const c = makeClient();
    const { reg } = await onboard(c, '01033333337');
    const stranger = await login(c, '01033333338');
    const r = await c.call('POST', '/v1/checkin', { refreshToken: stranger.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    expect(r.status).toBe(404);
  });

  it('after the trial the licence lets the app fall back to the free plan with ads', async () => {
    const c = makeClient();
    const { auth, reg } = await onboard(c, '01033333339');
    c.advance(15 * DAY_MS);
    const r = await c.call('POST', '/v1/checkin', { refreshToken: auth.refreshToken, deviceId: reg.deviceId, appVersion: '0.1.0', deviceTime: c.clock.now });
    const s = computeLicenceState(verifyLicence(r.json.licence, keys), { now: c.clock.now, deviceId: reg.deviceId, maxSeenTime: c.clock.now });
    expect(s.mode).toBe('free');
    expect(s.showAds).toBe(true);
    expect(s.limits.products).toBe(100);
  });
});

describe('authorization', () => {
  it('rejects missing / forged access tokens', async () => {
    const c = makeClient();
    expect((await c.call('GET', '/v1/sessions')).status).toBe(401);
    expect((await c.call('GET', '/v1/sessions', undefined, { Authorization: 'Bearer at1.eyJ.abc' })).status).toBe(401);
  });
  it('access tokens expire after 15 minutes', async () => {
    const c = makeClient();
    const auth = await login(c, '01044444441');
    c.advance(16 * 60_000);
    expect((await c.call('GET', '/v1/sessions', undefined, { Authorization: `Bearer ${auth.accessToken}` })).status).toBe(401);
  });
});
