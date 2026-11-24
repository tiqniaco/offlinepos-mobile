/**
 * Multi-user on one shop. A cashier phone («موبايل كاشير», devices.role = 'satellite') joins by a QR shown on the shop's
 * main phone, sells offline, and pushes its sales here; the main phone pulls and posts them, and uploads the
 * catalog (products, prices, customers, users…) that cashier phones download. All payloads are sealed on the phones
 * with the shop's sync key (in the QR only): the server stores opaque blobs.
 *
 *  POST /sync/invite        main phone (owner session) → one-time join code (15 min), within the plan's phones
 *  POST /sync/join          new phone with the code → device session + licence (no account login)
 *  PUT  /sync/catalog       main phone uploads the sealed catalog (R2)          GET /sync/catalog  cashier phone
 *  POST /sync/ops           cashier phone pushes sealed sales (idempotent by seq) GET /sync/status  its progress
 *  GET  /sync/ops           main phone pulls pending sales                         POST /sync/ops/ack marks them applied
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  SYNC_CATALOG_MAX_BYTES,
  SYNC_INVITE_TTL_MS,
  SYNC_OP_MAX_BYTES,
  syncInviteSchema,
  syncJoinSchema,
  syncOpsPushSchema,
  uuidv7,
} from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body, clientIp } from '../lib/http';
import { sha256HexAsync } from '../lib/crypto';
import { createSession, requireDeviceSession, requireSession } from '../auth/tokens';
import { buildLicence, effectiveLimits, type BusinessRow } from '../licence/issue';
import { limitReached, track } from '../usage/meter';
import { bumpCounter } from '../otp/service';
import { newDeviceAlert } from '../announce/announce';
import { ownedBusiness } from './phase6';
import { deviceCode, type Deps } from './v1';

type CheckIntegrity = (env: Env, input: z.infer<typeof syncJoinSchema>['integrity'], action: 'signup' | 'activate' | 'checkin', now: number, deviceId?: string) => Promise<unknown>;

const OPS_KEEP_MS = 14 * 86_400_000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const catalogKey = (businessId: string) => `sync/${businessId}/catalog`;

export async function countCashierPhones(env: Env, businessId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM devices WHERE business_id = ?1 AND deactivated_at IS NULL AND role = 'satellite'`).bind(businessId).first<{ n: number }>();
  return r?.n ?? 0;
}

function inviteCode(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join('');
}

async function activeDevices(env: Env, businessId: string): Promise<number> {
  return (await env.DB.prepare(`SELECT COUNT(*) AS n FROM devices WHERE business_id = ?1 AND deactivated_at IS NULL`).bind(businessId).first<{ n: number }>())?.n ?? 0;
}

/** The owner's MAIN phone of this shop (sync from the main phone only). */
async function mainDevice(env: Env, businessId: string, deviceId: string) {
  const d = await env.DB.prepare(`SELECT id FROM devices WHERE id = ?1 AND business_id = ?2 AND role = 'main' AND deactivated_at IS NULL`).bind(deviceId, businessId).first<{ id: string }>();
  if (!d) throw new ApiError(403, 'wrong_device_role');
  return d;
}

/** The cashier phone behind a device session. A stopped phone may still deliver its sales (`allowStopped`). */
async function cashierDevice(env: Env, s: { sid: string; businessId: string }, deviceId: string, allowStopped = false) {
  const d = await env.DB.prepare(`SELECT id, business_id, deactivated_at, session_id FROM devices WHERE id = ?1 AND business_id = ?2 AND role = 'satellite'`)
    .bind(deviceId, s.businessId)
    .first<{ id: string; business_id: string; deactivated_at: number | null; session_id: string | null }>();
  if (!d || d.session_id !== s.sid) throw new ApiError(403, 'wrong_device_role');
  if (d.deactivated_at && !allowStopped) throw new ApiError(403, 'device_deactivated');
  return d;
}

/**
 * How far this phone's sales are applied, with no gap: every seq ≤ the answer is applied. A sale the main phone could
 * not post stays unapplied (it is retried), so the cashier phone never forgets it.
 */
async function appliedUpTo(env: Env, deviceId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT (SELECT MIN(seq) FROM sync_ops WHERE device_id = ?1 AND applied_at IS NULL) AS gap, (SELECT MAX(seq) FROM sync_ops WHERE device_id = ?1 AND applied_at IS NOT NULL) AS top`,
  )
    .bind(deviceId)
    .first<{ gap: number | null; top: number | null }>();
  return r?.gap != null ? r.gap - 1 : (r?.top ?? 0);
}

export function addSyncRoutes(app: Hono<AppEnv>, deps: Deps, checkIntegrity: CheckIntegrity) {
  app.post('/sync/invite', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, syncInviteSchema);
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    await mainDevice(c.env, business.id, b.deviceId);
    const { limits } = await effectiveLimits(c.env, business, now);
    const limit = limits.devices ?? 1;
    const used = await activeDevices(c.env, business.id);
    if (limit >= 0 && used >= limit) throw limitReached('devices', limit, used, `this plan allows ${limit} phone(s)`, 403);
    if ((await bumpCounter(c.env.DB, `invite:${business.id}`, 3_600_000, now)) > 20) throw new ApiError(429, 'rate_limited', undefined, 600_000);
    const code = inviteCode();
    await c.env.DB.prepare(`INSERT INTO device_invites (code_hash, business_id, created_by_device, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(await sha256HexAsync(code), business.id, b.deviceId, now, now + SYNC_INVITE_TTL_MS)
      .run();
    return c.json({ code, expiresAt: now + SYNC_INVITE_TTL_MS }, 201);
  });

  app.post('/sync/join', async (c) => {
    const now = deps.now();
    if ((await bumpCounter(c.env.DB, `join-ip:${clientIp(c)}`, 3_600_000, now)) > 20) throw new ApiError(429, 'rate_limited', undefined, 600_000);
    const b = await body(c, syncJoinSchema);
    const hash = await sha256HexAsync(b.code);
    const inv = await c.env.DB.prepare(`SELECT business_id, expires_at, used_at FROM device_invites WHERE code_hash = ?1`).bind(hash).first<{ business_id: string; expires_at: number; used_at: number | null }>();
    if (!inv || inv.used_at || inv.expires_at < now) throw new ApiError(404, 'code_invalid');
    await checkIntegrity(c.env, b.integrity, 'activate', now);
    {
      // The shop has no free phone slot: say so without using up the code.
      const biz = (await c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(inv.business_id).first<BusinessRow>())!;
      const lim = (await effectiveLimits(c.env, biz, now)).limits.devices ?? 1;
      const used = await activeDevices(c.env, biz.id);
      if (lim >= 0 && used >= lim) throw limitReached('devices', lim, used, `this plan allows ${lim} phone(s)`, 403);
    }
    // One use only (atomic claim).
    const claim = await c.env.DB.prepare(`UPDATE device_invites SET used_at = ?2 WHERE code_hash = ?1 AND used_at IS NULL AND expires_at >= ?2`).bind(hash, now).run();
    if (claim.meta.changes !== 1) throw new ApiError(404, 'code_invalid');
    const business = (await c.env.DB.prepare(`SELECT * FROM businesses WHERE id = ?1`).bind(inv.business_id).first<BusinessRow>())!;
    if (business.status === 'suspended') throw new ApiError(403, 'business_suspended');
    const { limits } = await effectiveLimits(c.env, business, now);
    const limit = limits.devices ?? 1;
    const tokens = await createSession(c.env, { accountId: business.owner_account_id, device: b.device, ip: clientIp(c), now, deviceBusinessId: business.id });
    const seq = await c.env.DB.prepare(`UPDATE businesses SET next_device_seq = next_device_seq + 1 WHERE id = ?1 RETURNING next_device_seq`).bind(business.id).first<{ next_device_seq: number }>();
    const id = uuidv7(now);
    const code = deviceCode(seq!.next_device_seq - 1);
    const ins = await c.env.DB.prepare(
      `INSERT INTO devices (id, business_id, code, session_id, install_id, platform, model, app_version, activated_at, last_checkin_at, role)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 'satellite'
       WHERE ?10 < 0 OR (SELECT COUNT(*) FROM devices WHERE business_id = ?2 AND deactivated_at IS NULL) < ?10`,
    )
      .bind(id, business.id, code, tokens.sessionId, b.device.installId, b.device.platform, b.device.model ?? null, b.device.appVersion, now, limit)
      .run();
    if (ins.meta.changes !== 1) {
      await c.env.DB.prepare(`UPDATE sessions SET revoked_at = ?2, revoke_reason = 'device_limit' WHERE id = ?1`).bind(tokens.sessionId, now).run();
      throw limitReached('devices', limit, await activeDevices(c.env, business.id), `this plan allows ${limit} phone(s)`, 403);
    }
    await c.env.DB.prepare(`UPDATE device_invites SET used_device_id = ?2 WHERE code_hash = ?1`).bind(hash, id).run();
    await newDeviceAlert(c.env, business, { id, model: b.device.model, platform: b.device.platform }, now, deps.push);
    track(business.id, 'sync_events');
    return c.json(
      {
        business: { id: business.id, name: business.name, country: business.country, type: business.type },
        deviceId: id,
        deviceCode: code,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        accessExpiresAt: tokens.accessExpiresAt,
        licence: await buildLicence(c.env, business, { id, business_id: business.id, code, deactivated_at: null }, now),
        serverTime: now,
      },
      201,
    );
  });

  app.put('/sync/catalog', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const business = await ownedBusiness(c.env, c.req.header('X-Business-Id') ?? '', s.aid);
    await mainDevice(c.env, business.id, c.req.header('X-Device-Id') ?? '');
    const len = Number(c.req.header('Content-Length') ?? 0);
    if (len > SYNC_CATALOG_MAX_BYTES) throw new ApiError(413, 'invalid_request', 'catalog too large');
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (!data.length || data.length > SYNC_CATALOG_MAX_BYTES) throw new ApiError(data.length ? 413 : 400, 'invalid_request');
    const cashiers = await countCashierPhones(c.env, business.id);
    if ((await bumpCounter(c.env.DB, `catalog:${business.id}`, 60_000, now)) > 2) throw new ApiError(429, 'rate_limited', undefined, 60_000);
    const prev = (await c.env.DB.prepare(`SELECT catalog_version AS v FROM sync_state WHERE business_id = ?1`).bind(business.id).first<{ v: number }>())?.v ?? 0;
    const version = Math.max(now, prev + 1);
    await c.env.BACKUPS.put(catalogKey(business.id), data, { httpMetadata: { contentType: 'application/octet-stream' } });
    await c.env.DB.prepare(
      `INSERT INTO sync_state (business_id, catalog_version, catalog_size, updated_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (business_id) DO UPDATE SET catalog_version = ?2, catalog_size = ?3, updated_at = ?4`,
    )
      .bind(business.id, version, data.length, now)
      .run();
    track(business.id, 'sync_events', 1, data.length);
    return c.json({ version, satellites: cashiers });
  });

  app.get('/sync/catalog', async (c) => {
    const now = deps.now();
    const s = await requireDeviceSession(c.env, c.req.header('Authorization'), now);
    await cashierDevice(c.env, s, c.req.query('deviceId') ?? '');
    const st = await c.env.DB.prepare(`SELECT catalog_version AS v FROM sync_state WHERE business_id = ?1`).bind(s.businessId).first<{ v: number }>();
    if (!st) throw new ApiError(404, 'not_found', 'no catalog yet');
    const obj = await c.env.BACKUPS.get(catalogKey(s.businessId));
    if (!obj) throw new ApiError(404, 'not_found', 'no catalog yet');
    track(s.businessId, 'sync_events', 1, obj.size);
    return new Response(obj.body, { headers: { 'Content-Type': 'application/octet-stream', 'X-Catalog-Version': String(st.v) } });
  });

  app.get('/sync/status', async (c) => {
    const now = deps.now();
    const s = await requireDeviceSession(c.env, c.req.header('Authorization'), now);
    const d = await cashierDevice(c.env, s, c.req.query('deviceId') ?? '', true);
    const st = await c.env.DB.prepare(`SELECT catalog_version AS v FROM sync_state WHERE business_id = ?1`).bind(s.businessId).first<{ v: number }>();
    // "Last seen" of the cashier phone: at most one write per 10 minutes.
    await c.env.DB.prepare(`UPDATE devices SET last_checkin_at = ?2 WHERE id = ?1 AND (last_checkin_at IS NULL OR last_checkin_at < ?2 - 600000)`).bind(d.id, now).run();
    return c.json({ catalogVersion: st?.v ?? 0, appliedSeq: await appliedUpTo(c.env, d.id), serverTime: now, stopped: !!d.deactivated_at });
  });

  app.post('/sync/ops', async (c) => {
    const now = deps.now();
    const s = await requireDeviceSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, syncOpsPushSchema);
    const d = await cashierDevice(c.env, s, b.deviceId, true);
    if ((await bumpCounter(c.env.DB, `ops:${d.id}`, 3_600_000, now)) > 240) throw new ApiError(429, 'rate_limited', undefined, 300_000);
    for (const op of b.ops) if (op.data.length > Math.ceil((SYNC_OP_MAX_BYTES * 4) / 3) + 4) throw new ApiError(413, 'invalid_request', 'op too large');
    const res = await c.env.DB.batch(
      b.ops.map((op) =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO sync_ops (business_id, device_id, seq, data, size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(s.businessId, d.id, op.seq, op.data, op.data.length, now),
      ),
    );
    const stored = res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
    track(s.businessId, 'sync_events', stored, b.ops.reduce((n, o) => n + o.data.length, 0));
    return c.json({ stored, appliedSeq: await appliedUpTo(c.env, d.id) });
  });

  app.get('/sync/ops', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const business = await ownedBusiness(c.env, c.req.query('businessId') ?? '', s.aid);
    await mainDevice(c.env, business.id, c.req.query('deviceId') ?? '');
    const rows = await c.env.DB.prepare(
      `SELECT o.id, o.device_id AS deviceId, d.code AS deviceCode, o.seq, o.data FROM sync_ops o JOIN devices d ON d.id = o.device_id
       WHERE o.business_id = ?1 AND o.applied_at IS NULL ORDER BY o.device_id, o.seq LIMIT 101`,
    )
      .bind(business.id)
      .all<{ id: number; deviceId: string; deviceCode: string; seq: number; data: string }>();
    const ops = rows.results.slice(0, 100);
    return c.json({ ops, more: rows.results.length > 100 });
  });

  app.post('/sync/ops/ack', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, z.object({ businessId: z.string(), deviceId: z.string(), ids: z.array(z.number().int()).min(1).max(100) }));
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    await mainDevice(c.env, business.id, b.deviceId);
    await c.env.DB.batch(b.ids.map((id) => c.env.DB.prepare(`UPDATE sync_ops SET applied_at = ?3 WHERE id = ?1 AND business_id = ?2 AND applied_at IS NULL`).bind(id, business.id, now)));
    await pruneApplied(c.env, business.id, now);
    return c.json({ ok: true });
  });
}

/**
 * Applied ops older than 14 days are deleted, except each phone's highest applied one: its seq is how the cashier
 * phone learns how far its sales were applied (/sync/status, /sync/ops answer).
 */
async function pruneApplied(env: Env, businessId: string, now: number) {
  await env.DB.prepare(
    `DELETE FROM sync_ops WHERE business_id = ?1 AND applied_at IS NOT NULL AND applied_at < ?2
       AND seq < (SELECT MAX(x.seq) FROM sync_ops x WHERE x.device_id = sync_ops.device_id AND x.applied_at IS NOT NULL)`,
  )
    .bind(businessId, now - OPS_KEEP_MS)
    .run();
}
