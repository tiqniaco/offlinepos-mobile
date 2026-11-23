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

export function addReleaseRoutes(app: Hono<AppEnv>) {
  app.get('/app/latest', async (c) => {
    const platform = c.req.query('platform') === 'ios' ? 'ios' : 'android';
    const latest = await c.env.DB.prepare(
      `SELECT version_code, version_name, file_key, url, sha256, size, notes_ar, forced FROM app_releases
       WHERE platform = ?1 AND withdrawn_at IS NULL ORDER BY version_code DESC LIMIT 1`,
    )
      .bind(platform)
      .first<Row>();
    const min = await c.env.DB.prepare(`SELECT MAX(version_code) AS v FROM app_releases WHERE platform = ?1 AND forced = 1 AND withdrawn_at IS NULL`)
      .bind(platform)
      .first<{ v: number | null }>();
    if (!latest) return c.json({ latest: null, minCode: 0 });
    const origin = new URL(c.req.url).origin;
    const url = latest.file_key ? `${origin}/v1/app/download/${latest.file_key.replace(/^releases\//, '')}` : latest.url;
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({
      latest: { code: latest.version_code, name: latest.version_name, url, sha256: latest.sha256, size: latest.size, notesAr: latest.notes_ar },
      minCode: min?.v ?? 0,
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
