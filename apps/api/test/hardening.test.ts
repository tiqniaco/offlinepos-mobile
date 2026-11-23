/**
 * Adversarial regressions (security review): trial farming race, refresh-grace hijack, OTP third-party lockout,
 * password-lock enumeration, PDF name-escape bypass, OCR idempotency race, store vs manual plan time, check-in backup
 * caps, concurrent approvals, attach integrity, check-in side effects of a losing token.
 */
import { describe, expect, it } from 'vitest';
import { base32Encode, totpCode, uuidv7, DAY_MS } from '@daftarak/shared';
import { pbkdf2Hex } from '../src/lib/crypto';
import { makeClient, login, device, BACKUP_KEY } from './helpers';
import { ConsoleProvider } from '../src/otp/providers';
import { decodeScanUpload, type OcrClient } from '../src/ocr/scan';
import { BACKUP_HARD_CAP } from '../src/routes/phase6';

type Client = ReturnType<typeof makeClient>;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const RC = { Authorization: 'Bearer test-rc-secret' };
const SHA = 'd'.repeat(64);
const MB = 1024 * 1024;
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const JPEG2 = b64([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x02, 0xff, 0xd9]);
const newBiz = (c: Client, tok: string, name = 'Shop', inst = 'install-0001') =>
  c.call('POST', '/v1/businesses', { name, country: 'EG', type: 'shop', vatRegistered: false, backupKey: BACKUP_KEY, device: device(inst) }, bearer(tok));
const biz = (c: Client, id: string) => c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(id).first<any>();
const checkin = (c: Client, refreshToken: string, deviceId: string, extra: object = {}) =>
  c.call('POST', '/v1/checkin', { refreshToken, deviceId, appVersion: '0.1.0', deviceTime: c.clock.now, ...extra });

async function shop(c: Client, phone: string) {
  const auth = await login(c, phone, `inst-${phone}`);
  const r = await newBiz(c, auth.accessToken, 'محل', `inst-${phone}`);
  expect(r.status).toBe(201);
  return { auth, h: bearer(auth.accessToken), businessId: r.json.business.id as string, deviceId: r.json.registration.deviceId as string };
}

const SECRET = base32Encode(new Uint8Array(20).map((_, i) => i + 7));
async function admin(c: Client, email: string) {
  const salt = '00112233445566778899aabbccddeeff';
  await c.env.DB.prepare(`INSERT INTO admin_users (id, email, password_hash, password_salt, totp_secret, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(uuidv7(), email, await pbkdf2Hex('correct horse', salt), salt, SECRET, c.clock.now)
    .run();
  const r = await c.call('POST', '/admin/login', { email, password: 'correct horse', totp: totpCode(SECRET, c.clock.now) });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.json.token}` };
}

describe('trial farming', () => {
  it('8 parallel creates: at most 2 businesses and at most 1 trial', async () => {
    const c = makeClient();
    c.setIp('10.9.0.1');
    const a = await login(c, '01088880001');
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => newBiz(c, a.accessToken, `B${i}`)));
    const rows = (await c.env.DB.prepare(`SELECT status FROM businesses WHERE owner_account_id = ?1`).bind(a.account.id).all<any>()).results;
    expect(rows.length).toBeLessThanOrEqual(2);
    expect(rows.filter((r) => r.status === 'trial').length).toBeLessThanOrEqual(1);
    expect(res.filter((r) => r.status === 201).length).toBe(rows.length);
    expect(res.filter((r) => r.status !== 201).every((r) => r.json.error.code === 'business_limit_reached')).toBe(true);
  });
});

describe('refresh token grace', () => {
  it('a thief replaying the old token gets at most one grace refresh; then the orphan revokes the whole session', async () => {
    const c = makeClient();
    c.setIp('10.9.0.2');
    const s = await shop(c, '01088880002');
    const legit = await checkin(c, s.auth.refreshToken, s.deviceId); // T1 → T2
    expect(legit.status).toBe(200);
    c.advance(30_000);
    const thief = await c.call('POST', '/v1/auth/refresh', { refreshToken: s.auth.refreshToken }); // T1 replayed within grace
    // The owner's next check-in presents T2, superseded by the thief's grace refresh: the session is revoked for both.
    const legit2 = await checkin(c, legit.json.refreshToken, s.deviceId);
    expect([legit2.status, legit2.json.error.code]).toEqual([401, 'session_revoked']);
    if (thief.status === 200) {
      const thief2 = await c.call('POST', '/v1/auth/refresh', { refreshToken: thief.json.refreshToken });
      expect([thief2.status, thief2.json.error.code]).toEqual([401, 'session_revoked']);
    }
    const sess = await c.env.DB.prepare(`SELECT revoked_at, revoke_reason FROM sessions WHERE account_id = ?1`).bind(s.auth.account.id).first<any>();
    expect(sess.revoke_reason).toBe('refresh_reuse');
  });

  it('a lost check-in response is still retried once with the old token (and the new pair keeps working)', async () => {
    const c = makeClient();
    c.setIp('10.9.0.3');
    const s = await shop(c, '01088880003');
    const lost = await checkin(c, s.auth.refreshToken, s.deviceId);
    expect(lost.status).toBe(200); // the phone never received this answer
    c.advance(20_000);
    const retry = await checkin(c, s.auth.refreshToken, s.deviceId, { installId: `inst-01088880003` });
    expect(retry.status).toBe(200);
    c.advance(DAY_MS);
    expect((await checkin(c, retry.json.refreshToken, s.deviceId)).status).toBe(200);
  });

  it('no grace once the live token was used, or from another install; older tokens revoke the session', async () => {
    const c = makeClient();
    c.setIp('10.9.0.4');
    const s = await shop(c, '01088880004');
    const r1 = await c.call('POST', '/v1/auth/refresh', { refreshToken: s.auth.refreshToken }); // T1 → T2
    const r2 = await c.call('POST', '/v1/auth/refresh', { refreshToken: r1.json.refreshToken }); // T2 → T3
    expect(r2.status).toBe(200);
    // T1 is now an OLDER token (not even the previous one): presenting it revokes the session.
    const old = await c.call('POST', '/v1/auth/refresh', { refreshToken: s.auth.refreshToken });
    expect([old.status, old.json.error.code]).toEqual([401, 'session_revoked']);

    const c2 = makeClient();
    c2.setIp('10.9.0.5');
    const t = await shop(c2, '01088880005');
    const ok = await checkin(c2, t.auth.refreshToken, t.deviceId);
    expect(ok.status).toBe(200);
    const other = await c2.call('POST', '/v1/auth/refresh', { refreshToken: t.auth.refreshToken, installId: 'some-other-install' });
    expect([other.status, other.json.error.code]).toEqual([401, 'session_revoked']);
  });
});

describe('OTP third-party lockout', () => {
  it("11 junk verifies for a phone with no pending code don't block the owner's correct code", async () => {
    const c = makeClient();
    c.setIp('10.9.0.6');
    for (let i = 0; i < 11; i++) {
      const r = await c.call('POST', '/v1/auth/otp/verify', { phone: '01088880006', code: '000000', device: device() });
      expect(r.json.error.code).toBe('otp_invalid');
    }
    c.setIp('10.9.0.7');
    const r1 = await c.call('POST', '/v1/auth/otp/request', { phone: '01088880006' });
    const v = await c.call('POST', '/v1/auth/otp/verify', { phone: '01088880006', code: ConsoleProvider.lastCodeFor(r1.json.phone)!, device: device() });
    expect(v.status).toBe(200);
  });

  it("an attacker's wrong guesses from one network don't use up the owner's hourly verify budget", async () => {
    const c = makeClient();
    const phone = '01088880016';
    c.setIp('10.9.0.8');
    const r1 = await c.call('POST', '/v1/auth/otp/request', { phone });
    const real = ConsoleProvider.lastCodeFor(r1.json.phone)!;
    // 4 wrong guesses (the 5th would burn the code), then 10 more blocked by the (phone, IP) cap.
    const wrong = real === '000001' ? '000002' : '000001';
    for (let i = 0; i < 4; i++) await c.call('POST', '/v1/auth/otp/verify', { phone, code: wrong, device: device() });
    c.setIp('10.9.0.9');
    const v = await c.call('POST', '/v1/auth/otp/verify', { phone, code: real, device: device() });
    expect(v.status).toBe(200);
  });
});

describe('password login enumeration', () => {
  it('unknown phone, SMS-only account and a password account answer the same sequence (lock included)', async () => {
    const c = makeClient();
    c.setIp('10.9.1.4');
    const a = await login(c, '01088880024');
    expect((await c.call('POST', '/v1/auth/password/set', { password: 'Str0ng-pass-123' }, bearer(a.accessToken))).status).toBe(200);
    await login(c, '01088880025'); // SMS-only account (no password)
    const tryN = async (phone: string, n: number) => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) {
        const r = await c.call('POST', '/v1/auth/password/login', { phone, password: `wrong-pass-${i}`, device: device() });
        out.push(`${r.status}:${r.json.error.code}:${r.json.error.message}`);
      }
      return out;
    };
    const withPw = await tryN('01088880024', 7);
    expect(withPw.slice(4)).toEqual(['429:password_locked:900', '429:password_locked:900', '429:password_locked:900']);
    expect(await tryN('01088880099', 7)).toEqual(withPw);
    expect(await tryN('01088880025', 7)).toEqual(withPw);
    // After the lock: one more failure doubles it, the same way.
    c.advance(16 * 60_000);
    const after = await tryN('01088880024', 1);
    expect(after).toEqual(['429:password_locked:1800']);
    expect(await tryN('01088880099', 1)).toEqual(after);
  });
});

describe('PDF checks', () => {
  const refuse = (pdf: string) => {
    try {
      decodeScanUpload({ file: btoa(pdf), mediaType: 'application/pdf' });
      return 'accepted';
    } catch (e) {
      return (e as { code: string }).code;
    }
  };
  it('name escapes cannot hide pages or object streams; encrypted PDFs are refused', () => {
    let many = '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n3 0 obj << /Type /Page >> endobj\n';
    for (let i = 4; i < 80; i++) many += `${i} 0 obj << /Type /P#61ge /Parent 2 0 R >> endobj\n`;
    expect(refuse(many)).toBe('pdf_too_large');
    expect(refuse('%PDF-1.5\n1 0 obj << /Type /O#62jStm >> endobj\n3 0 obj << /Type /Page >> endobj\n')).toBe('pdf_unsupported');
    expect(refuse('%PDF-1.5\n3 0 obj << /Type /Page >> endobj\ntrailer << /Root 1 0 R /Encrypt 9 0 R >>\n')).toBe('pdf_unsupported');
    expect(refuse('%PDF-1.5\n3 0 obj << /Type /Page >> endobj\ntrailer << /Root 1 0 R /Encr#79pt 9 0 R >>\n')).toBe('pdf_unsupported');
    // /Pages (escaped or not) is not a page.
    expect(refuse('%PDF-1.4\n1 0 obj << /Type /P#61ges >> endobj\n2 0 obj << /Type /Page >> endobj\n')).toBe('accepted');
  });
});

describe('OCR idempotency', () => {
  it('parallel requests with the same key call the model and charge once', async () => {
    let calls = 0;
    const client: OcrClient = {
      beta: {
        messages: {
          create: async (params: any) => {
            calls++;
            await new Promise((r) => setTimeout(r, 30));
            return {
              id: 'msg_1', type: 'message', role: 'assistant', model: params.model,
              content: [{ type: 'text', text: JSON.stringify({ supplierName: 'x', invoiceNo: null, date: null, currency: 'EGP', lines: [{ name: 'سكر', qty: 1, unitPrice: 10, total: 10 }], subtotal: 10, discount: null, tax: null, total: 10 }) }],
              stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 },
            } as any;
          },
        },
      },
    };
    const c = makeClient(1_950_000_000_000, { ocrClient: () => client });
    c.setIp('10.9.2.1');
    const s = await shop(c, '01088880031');
    const h = { ...s.h, 'X-Idempotency-Key': 'scan-parallel-0001' };
    const rs = await Promise.all([1, 2, 3].map(() => c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, h)));
    expect(calls).toBe(1);
    expect(rs.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(rs.filter((r) => r.status !== 200).every((r) => r.json.error.code === 'rate_limited')).toBe(true);
    const rows = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM ocr_scans WHERE business_id = ?1`).bind(s.businessId).first<any>();
    expect(rows.n).toBe(1);
    // A retry after the scan finished gets the stored result.
    const again = await c.call('POST', '/v1/purchases/scan', { businessId: s.businessId, image: JPEG }, h);
    expect(again.status).toBe(200);
    expect(calls).toBe(1);
  });
});

describe('store plan vs manual time', () => {
  async function redeem(c: Client, s: Awaited<ReturnType<typeof shop>>, plan: string, days: number) {
    const code = 'ABCD-EFGH-' + String(Math.floor(Math.random() * 9000) + 1000).replace(/[01]/g, '2');
    await c.env.DB.prepare(`INSERT INTO activation_codes (code, plan_code, days, batch, created_at) VALUES (?1, ?2, ?3, 't', ?4)`).bind(code, plan, days, c.clock.now).run();
    const r = await c.call('POST', '/v1/licence/activation-code', { businessId: s.businessId, code }, s.h);
    expect(r.status).toBe(200);
  }
  const rc = (c: Client, businessId: string, id: string, type: string, exp: number) =>
    c.call('POST', '/v1/webhooks/revenuecat', { event: { id, type, app_user_id: businessId, product_id: 'daftarak_pro_monthly', expiration_at_ms: exp, environment: 'PRODUCTION' } }, RC);

  it('manual basic 300 days + store pro 30 days → pro until day 30, then basic until day 300', async () => {
    const c = makeClient();
    c.setIp('10.9.3.1');
    const s = await shop(c, '01088880041');
    const t0 = c.clock.now;
    await redeem(c, s, 'basic', 300);
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'basic', plan_expires_at: t0 + 300 * DAY_MS, manual_plan_code: 'basic', manual_until: t0 + 300 * DAY_MS });
    await rc(c, s.businessId, 'e1', 'INITIAL_PURCHASE', t0 + 30 * DAY_MS);
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'pro', plan_source: 'store', plan_expires_at: t0 + 30 * DAY_MS });
    c.advance(30 * DAY_MS + 1000);
    await rc(c, s.businessId, 'e2', 'EXPIRATION', t0 + 30 * DAY_MS);
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'basic', plan_source: 'manual', plan_expires_at: t0 + 300 * DAY_MS, status: 'active' });
  });

  it('a refund falls back to the manual plan; a late / lost EXPIRATION is applied at the next check-in', async () => {
    const c = makeClient();
    c.setIp('10.9.3.2');
    const s = await shop(c, '01088880042');
    const t0 = c.clock.now;
    await redeem(c, s, 'basic', 300);
    await rc(c, s.businessId, 'f1', 'INITIAL_PURCHASE', t0 + 30 * DAY_MS);
    await c.call('POST', '/v1/webhooks/revenuecat', { event: { id: 'f2', type: 'CANCELLATION', cancel_reason: 'CUSTOMER_SUPPORT', app_user_id: s.businessId, product_id: 'daftarak_pro_monthly', environment: 'PRODUCTION' } }, RC);
    expect(await biz(c, s.businessId)).toMatchObject({ plan_code: 'basic', plan_expires_at: t0 + 300 * DAY_MS });

    const u = await shop(c, '01088880043');
    await redeem(c, u, 'basic', 300);
    await rc(c, u.businessId, 'g1', 'INITIAL_PURCHASE', t0 + 30 * DAY_MS);
    c.advance(31 * DAY_MS);
    const ci = await checkin(c, u.auth.refreshToken, u.deviceId);
    expect(ci.status).toBe(200);
    expect(await biz(c, u.businessId)).toMatchObject({ plan_code: 'basic', plan_expires_at: t0 + 300 * DAY_MS });
  });
});

describe('backups via check-in', () => {
  const meta = (size: number, counts: Record<string, number> = { sales: 10 }) => ({ size, sha256: SHA, counts, schemaVersion: 1 });

  it('check-in starts at most one backup per business per day', async () => {
    const c = makeClient();
    c.setIp('10.9.4.1');
    const s = await shop(c, '01088880051');
    let tok = s.auth.refreshToken;
    let puts = 0;
    for (let i = 0; i < 15; i++) {
      const r = await checkin(c, tok, s.deviceId, { backupMeta: meta(50 * MB) });
      expect(r.status).toBe(200);
      tok = r.json.refreshToken;
      if (r.json.backupPut) puts++;
    }
    expect(puts).toBe(1);
    c.advance(DAY_MS);
    expect((await checkin(c, tok, s.deviceId, { backupMeta: meta(10) })).json.backupPut).toBeTruthy();
  });

  it('hard cap per business on committed backups (count and bytes), across devices', async () => {
    const c = makeClient();
    c.setIp('10.9.4.2');
    const s = await shop(c, '01088880052');
    await c.env.DB.prepare(`UPDATE businesses SET plan_code = 'free', status = 'active', plan_expires_at = ?2 WHERE id = ?1`).bind(s.businessId, c.clock.now).run();
    const cap = BACKUP_HARD_CAP.free!;
    // Older backups from other (former) devices: per-device retention never sees them.
    const seed = async (n: number, size: number) => {
      for (let i = 0; i < n; i++) {
        c.advance(60_000);
        const id = uuidv7(c.clock.now);
        const key = `b/${s.businessId}/old-dev-${i}/${id}.obk`;
        await c.env.BACKUPS.put(key, 'x');
        await c.env.DB.prepare(`INSERT INTO backups (id, business_id, device_id, r2_key, size, sha256, counts_json, schema_version, kind, created_at, committed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{"sales":10}', 1, 'auto', ?7, ?7)`)
          .bind(id, s.businessId, `old-dev-${i}`, key, size, SHA, c.clock.now)
          .run();
      }
    };
    const upload = async () => {
      c.advance(60_000);
      const u = await c.call('POST', '/v1/backups/upload-url', { businessId: s.businessId, deviceId: s.deviceId, meta: meta(5) }, s.h);
      expect(u.status).toBe(200);
      await c.env.BACKUPS.put(new URL(u.json.url).pathname.split('/').slice(2).join('/'), 'x'.repeat(5));
      expect((await c.call('POST', `/v1/backups/${u.json.backupId}/commit`, { businessId: s.businessId }, s.h)).status).toBe(200);
    };
    const committed = async () => (await c.env.DB.prepare(`SELECT COUNT(*) AS n, SUM(size) AS bytes FROM backups WHERE business_id = ?1 AND committed_at IS NOT NULL`).bind(s.businessId).first<any>());
    await seed(5, 10);
    await upload();
    expect((await committed()).n).toBe(cap.count);
    expect((await c.env.BACKUPS.list({ prefix: `b/${s.businessId}/` })).objects.length).toBe(cap.count);
    // Bytes: two big ones fill the budget; the older one goes.
    await seed(2, 100 * MB);
    await upload();
    const after = await committed();
    expect(after.bytes).toBeLessThanOrEqual(cap.bytes);
    expect(after.n).toBeLessThanOrEqual(cap.count);
    const big = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM backups WHERE business_id = ?1 AND size = ?2`).bind(s.businessId, 100 * MB).first<any>();
    expect(big.n).toBe(1);
  });
});

describe('concurrent approvals', () => {
  it('two approvals for the same shop in parallel: one gets 409, the retry adds its days (none lost)', async () => {
    const c = makeClient();
    c.setIp('10.9.5.1');
    const a = await admin(c, 'race@kashiro.app');
    const s = await shop(c, '01088880061');
    const req = (receipt: string) => c.call('POST', '/v1/billing/manual/requests', { businessId: s.businessId, plan: 'pro', period: 'monthly', method: 'instapay', payerPhone: '01558858884', receipt }, s.h);
    const r1 = await req(JPEG);
    const r2 = await req(JPEG2);
    expect([r1.status, r2.status]).toEqual([201, 201]);
    const t0 = (await biz(c, s.businessId)).plan_expires_at; // the trial is pro: both months extend it
    const res = await Promise.all([r1, r2].map((r) => c.call('POST', `/admin/payment-requests/${r.json.id}/approve`, {}, a)));
    const lost = res.findIndex((r) => r.status !== 200);
    expect(lost).toBeGreaterThanOrEqual(0); // the two approvals really raced
    if (lost >= 0) {
      expect([res[lost]!.status, res[lost]!.json.error.code]).toEqual([409, 'concurrent_update']);
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      const retry = await c.call('POST', `/admin/payment-requests/${[r1, r2][lost]!.json.id}/approve`, {}, a);
      expect(retry.status).toBe(200);
    }
    expect((await biz(c, s.businessId)).plan_expires_at).toBe(t0 + 62 * DAY_MS);
  });
});

describe('attach + check-in side effects', () => {
  it('/devices/attach runs the device-integrity check like /devices/activate', async () => {
    const c = makeClient(1_800_000_000_000, {}, { INTEGRITY_MODE: 'enforce' } as any);
    c.setIp('10.9.6.1');
    const s = await shop(c, '01088880071');
    const r = await c.call('POST', '/v1/devices/attach', { businessId: s.businessId, device: device('inst-01088880071') }, s.h);
    expect(r.status).toBe(200);
    const d = await c.env.DB.prepare(`SELECT integrity_status FROM devices WHERE id = ?1`).bind(r.json.registration.deviceId).first<any>();
    expect(d.integrity_status).toBe('unverified');
  });

  it('parallel check-ins with one token: only the winner stores the anchor and moves the inbox cursor', async () => {
    const c = makeClient();
    c.setIp('10.9.6.2');
    const s = await shop(c, '01088880072');
    const anchor = { chainSeq: 5, chainHead: 'a'.repeat(64), auditSeq: 3, auditHead: 'b'.repeat(64) };
    const rs = await Promise.all([1, 2, 3].map(() => checkin(c, s.auth.refreshToken, s.deviceId, { anchor })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    const n = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM anchors WHERE device_id = ?1`).bind(s.deviceId).first<any>();
    expect(n.n).toBe(1);
  });
});
