/**
 * Multi-device phase 1 — «موبايل متابعة»: the owner follows the shop from another phone, read-only.
 *  - POST /devices/follow   a phone joins as a follower (SMS step-up; counts against the plan's `devices` limit)
 *  - POST /snapshot         the MAIN phone pushes its latest summary (≤ 48 KB, at most once per 5 min)
 *  - GET  /snapshot         a follower reads it
 *  - GET  /devices          the shop's active phones; POST /devices/:id/stop ends a follower
 * Plain D1 (one row per shop, overwritten): a few writes per shop per hour at most, well inside the free tier.
 */
import type { Hono } from 'hono';
import { z } from 'zod';
import { SNAPSHOT_MAX_BYTES, SNAPSHOT_MIN_INTERVAL_MS, followShopSchema, putSnapshotSchema, uuidv7 } from '@daftarak/shared';
import type { AppEnv, Env } from '../env';
import { ApiError, body } from '../lib/http';
import { requireSession } from '../auth/tokens';
import { effectiveLimits } from '../licence/issue';
import { limitReached, track } from '../usage/meter';
import { bumpCounter } from '../otp/service';
import { isKnownInstall, newDeviceAlert } from '../announce/announce';
import { ownedBusiness } from './phase6';
import { deviceCode, type Deps } from './v1';

type CheckIntegrity = (env: Env, input: z.infer<typeof followShopSchema>['integrity'], action: 'signup' | 'activate' | 'checkin', now: number, deviceId?: string) => Promise<unknown>;

export async function countFollowers(env: Env, businessId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM devices WHERE business_id = ?1 AND deactivated_at IS NULL AND role = 'follower'`).bind(businessId).first<{ n: number }>();
  return r?.n ?? 0;
}

type DevRow = { id: string; business_id: string; role: string; session_id: string | null; deactivated_at: number | null };
async function shopDevice(env: Env, deviceId: string, businessId: string): Promise<DevRow> {
  const d = await env.DB.prepare(`SELECT id, business_id, role, session_id, deactivated_at FROM devices WHERE id = ?1 AND business_id = ?2`).bind(deviceId, businessId).first<DevRow>();
  if (!d) throw new ApiError(404, 'not_found', 'device');
  if (d.deactivated_at) throw new ApiError(403, 'device_deactivated');
  return d;
}

export function addFollowRoutes(app: Hono<AppEnv>, deps: Deps, checkIntegrity: CheckIntegrity) {
  app.post('/devices/follow', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    // Reading the shop's figures from a new phone: the same fresh SMS step-up as moving the shop.
    if (!s.stepUpUntil || s.stepUpUntil < now) throw new ApiError(403, 'step_up_required');
    const b = await body(c, followShopSchema);
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    const main = await c.env.DB.prepare(`SELECT install_id FROM devices WHERE business_id = ?1 AND deactivated_at IS NULL AND role = 'main' LIMIT 1`).bind(business.id).first<{ install_id: string | null }>();
    if (main?.install_id && main.install_id === b.device.installId) throw new ApiError(409, 'wrong_device_role', 'this phone already runs the shop');
    await checkIntegrity(c.env, b.integrity, 'activate', now);
    const { limits } = await effectiveLimits(c.env, business, now);
    const limit = limits.devices ?? 1;
    const known = await isKnownInstall(c.env, business.id, b.device.installId);
    // Re-following from the same phone replaces its old follower row (does not use a second slot).
    await c.env.DB.prepare(`UPDATE devices SET deactivated_at = ?3 WHERE business_id = ?1 AND install_id = ?2 AND role = 'follower' AND deactivated_at IS NULL`).bind(business.id, b.device.installId, now).run();
    const seq = await c.env.DB.prepare(`UPDATE businesses SET next_device_seq = next_device_seq + 1 WHERE id = ?1 RETURNING next_device_seq`).bind(business.id).first<{ next_device_seq: number }>();
    const id = uuidv7(now);
    const code = deviceCode(seq!.next_device_seq - 1);
    // Atomic limit check: two phones following at once can never pass the limit together.
    const ins = await c.env.DB.prepare(
      `INSERT INTO devices (id, business_id, code, session_id, install_id, platform, model, app_version, activated_at, last_checkin_at, role)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, 'follower'
       WHERE ?10 < 0 OR (SELECT COUNT(*) FROM devices WHERE business_id = ?2 AND deactivated_at IS NULL) < ?10`,
    )
      .bind(id, business.id, code, s.sid, b.device.installId, b.device.platform, b.device.model ?? null, b.device.appVersion, now, limit)
      .run();
    if (ins.meta.changes !== 1) {
      const used = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM devices WHERE business_id = ?1 AND deactivated_at IS NULL`).bind(business.id).first<{ n: number }>())?.n ?? 0;
      throw limitReached('devices', limit, used, `this plan allows ${limit} phone(s)`, 403);
    }
    if (!known) await newDeviceAlert(c.env, business, { id, model: b.device.model, platform: b.device.platform }, now, deps.push);
    track(business.id, 'sync_events');
    return c.json({ business: { id: business.id, name: business.name, country: business.country, type: business.type }, deviceId: id, deviceCode: code }, 201);
  });

  app.post('/snapshot', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const raw = await c.req.text();
    if (raw.length > SNAPSHOT_MAX_BYTES + 512) throw new ApiError(413, 'invalid_request', 'snapshot too large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApiError(400, 'invalid_request');
    }
    const r = putSnapshotSchema.safeParse(parsed);
    if (!r.success) throw new ApiError(400, 'invalid_request', r.error.issues[0]?.message);
    const b = r.data;
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    const dev = await shopDevice(c.env, b.deviceId, business.id);
    if (dev.role !== 'main') throw new ApiError(403, 'wrong_device_role');
    const followers = await countFollowers(c.env, business.id);
    // Nobody follows: nothing stored (saves writes); the phone learns it and stops pushing until the next check-in.
    if (!followers) return c.json({ ok: false, followers: 0 });
    if ((await bumpCounter(c.env.DB, `snapshot:${business.id}`, SNAPSHOT_MIN_INTERVAL_MS - 30_000, now)) > 1)
      throw new ApiError(429, 'rate_limited', 'one snapshot per 5 minutes', SNAPSHOT_MIN_INTERVAL_MS);
    const data = JSON.stringify(b.snapshot);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO shop_snapshots (business_id, device_id, data, size, received_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (business_id) DO UPDATE SET device_id = ?2, data = ?3, size = ?4, received_at = ?5`,
      ).bind(business.id, dev.id, data, data.length, now),
      c.env.DB.prepare(`UPDATE devices SET last_checkin_at = ?2 WHERE id = ?1`).bind(dev.id, now),
    ]);
    track(business.id, 'sync_events', 1, data.length);
    return c.json({ ok: true, followers });
  });

  app.get('/snapshot', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const businessId = c.req.query('businessId') ?? '';
    const deviceId = c.req.query('deviceId') ?? '';
    const business = await ownedBusiness(c.env, businessId, s.aid);
    const dev = await shopDevice(c.env, deviceId, business.id);
    // Only the follower phone that registered with this login reads it (a stolen device id alone is useless).
    if (dev.role !== 'follower' || dev.session_id !== s.sid) throw new ApiError(403, 'wrong_device_role');
    if ((await bumpCounter(c.env.DB, `snapshot-read:${dev.id}`, 3_600_000, now)) > 60) throw new ApiError(429, 'rate_limited', undefined, 60_000);
    const [snap, main] = await Promise.all([
      c.env.DB.prepare(`SELECT data, received_at FROM shop_snapshots WHERE business_id = ?1`).bind(business.id).first<{ data: string; received_at: number }>(),
      c.env.DB.prepare(`SELECT MAX(last_checkin_at) AS t FROM devices WHERE business_id = ?1 AND role = 'main' AND deactivated_at IS NULL`).bind(business.id).first<{ t: number | null }>(),
    ]);
    // "Last seen" of the follower: at most one write per 10 minutes.
    await c.env.DB.prepare(`UPDATE devices SET last_checkin_at = ?2 WHERE id = ?1 AND (last_checkin_at IS NULL OR last_checkin_at < ?2 - 600000)`).bind(dev.id, now).run();
    return c.json({
      snapshot: snap ? (JSON.parse(snap.data) as unknown) : null,
      receivedAt: snap?.received_at ?? null,
      mainSeenAt: main?.t ?? null,
      businessName: business.name,
      serverTime: now,
    });
  });

  app.get('/devices', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const business = await ownedBusiness(c.env, c.req.query('businessId') ?? '', s.aid);
    const { limits } = await effectiveLimits(c.env, business, now);
    const rows = await c.env.DB.prepare(
      `SELECT id, code, role, model, platform, activated_at, last_checkin_at, session_id FROM devices
       WHERE business_id = ?1 AND deactivated_at IS NULL ORDER BY role = 'main' DESC, activated_at`,
    )
      .bind(business.id)
      .all<{ id: string; code: string; role: string; model: string | null; platform: string | null; activated_at: number; last_checkin_at: number | null; session_id: string | null }>();
    return c.json({
      limit: limits.devices ?? 1,
      devices: rows.results.map((d) => ({
        id: d.id,
        code: d.code,
        role: d.role === 'follower' ? 'follower' : 'main',
        model: d.model,
        platform: d.platform,
        activatedAt: d.activated_at,
        lastSeenAt: d.last_checkin_at,
        current: d.session_id === s.sid,
      })),
    });
  });

  /** Ends a follower phone (from the main phone, or the follower itself). The main phone is never stopped here. */
  app.post('/devices/:id/stop', async (c) => {
    const now = deps.now();
    const s = await requireSession(c.env, c.req.header('Authorization'), now);
    const b = await body(c, z.object({ businessId: z.string() }));
    const business = await ownedBusiness(c.env, b.businessId, s.aid);
    const r = await c.env.DB.prepare(`UPDATE devices SET deactivated_at = ?3 WHERE id = ?1 AND business_id = ?2 AND role = 'follower' AND deactivated_at IS NULL`)
      .bind(c.req.param('id'), business.id, now)
      .run();
    if (r.meta.changes !== 1) throw new ApiError(404, 'not_found');
    return c.json({ ok: true });
  });
}
