/**
 * In-app updates (owner decision 2026-11): the app asks for the latest release; anything below the newest
 * *forced* release must update before continuing. Android APKs are served from R2 (releases/…), signed with the
 * same upload key, so they install over the existing app. Public endpoints: no account data involved.
 */
import type { Hono } from 'hono';
import type { AppEnv } from '../env';
import { ApiError } from '../lib/http';

interface Row {
  version_code: number;
  version_name: string;
  file_key: string | null;
  url: string | null;
  sha256: string | null;
  size: number | null;
  notes_ar: string | null;
  forced: number;
}

/** A forced release only blocks this long after it was published (unless the row sets force_after). */
export const DEFAULT_FORCE_GRACE_MS = 48 * 3_600_000;

/**
 * Channels: "sideload" = APK served from R2 (default, the GitHub publish workflow writes these rows);
 * "store" = Play / App Store builds (STORE_BUILD=1), whose rows carry the store listing URL.
 */
export function addReleaseRoutes(app: Hono<AppEnv>, deps: { now: () => number } = { now: () => Date.now() }) {
  app.get('/app/latest', async (c) => {
    const platform = c.req.query('platform') === 'ios' ? 'ios' : 'android';
    const channel = c.req.query('channel') === 'store' ? 'store' : 'sideload';
    const now = deps.now();
    const latest = await c.env.DB.prepare(
      `SELECT version_code, version_name, file_key, url, sha256, size, notes_ar, forced FROM app_releases
       WHERE platform = ?1 AND channel = ?2 AND withdrawn_at IS NULL ORDER BY version_code DESC LIMIT 1`,
    )
      .bind(platform, channel)
      .first<Row>();
    // Forced releases: enforced once force_after passed; before that the app shows an optional update + a banner.
    const forced = await c.env.DB.prepare(
      `SELECT version_code AS v, COALESCE(force_after, created_at + ?3) AS at FROM app_releases
       WHERE platform = ?1 AND channel = ?2 AND forced = 1 AND withdrawn_at IS NULL ORDER BY version_code DESC LIMIT 20`,
    )
      .bind(platform, channel, DEFAULT_FORCE_GRACE_MS)
      .all<{ v: number; at: number }>();
    const enforced = forced.results.filter((r) => r.at <= now);
    const upcoming = forced.results.filter((r) => r.at > now);
    const minCode = enforced.length ? Math.max(...enforced.map((r) => r.v)) : 0;
    const next = upcoming.length ? upcoming.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    if (!latest) return c.json({ latest: null, minCode: 0, channel });
    const origin = new URL(c.req.url).origin;
    const url = channel === 'sideload' && latest.file_key ? `${origin}/v1/app/download/${latest.file_key.replace(/^releases\//, '')}` : latest.url;
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({
      latest: { code: latest.version_code, name: latest.version_name, url, sha256: latest.sha256, size: latest.size, notesAr: latest.notes_ar },
      minCode,
      /** A forced release that is not enforced yet: below this code the app shows a banner until `forceAt`. */
      ...(next && next.v > minCode ? { pendingMinCode: next.v, forceAt: next.at } : {}),
      channel,
    });
  });

  app.get('/app/download/:name', async (c) => {
    const name = c.req.param('name');
    if (!/^[A-Za-z0-9._-]+\.apk$/.test(name)) throw new ApiError(404, 'not_found');
    const obj = await c.env.BACKUPS.get(`releases/${name}`);
    if (!obj) throw new ApiError(404, 'not_found');
    return new Response(obj.body, {
      headers: {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Length': String(obj.size),
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    });
  });
}
