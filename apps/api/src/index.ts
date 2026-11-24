import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './env';
import { runCleanup } from './cron/cleanup';
import { setPublicOrigin } from './backups/r2';
import { publicPages } from './pages/public';
import { ApiError, errorResponse } from './lib/http';
import { defaultDeps, v1Routes, type Deps } from './routes/v1';
import { adminRoutes } from './admin/routes';
import { usageMiddleware } from './usage/meter';

export function createApp(deps: Deps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'not found' } }, 404));

  // Usage metering (usage_daily): one UPSERT per request after the answer; never blocks or fails a request.
  app.use('*', usageMiddleware(deps.now));
  // Backup URLs on this Worker (no R2 API keys set) need the public origin.
  app.use('*', async (c, next) => {
    setPublicOrigin(new URL(c.req.url).origin);
    await next();
  });

  app.get('/health', (c) => c.json({ ok: true }));
  // Home, privacy policy, terms, account deletion (Google sign-in consent screen + Google Play).
  app.route('/', publicPages());

  // The mobile app is not a browser: no CORS on /v1.
  app.route('/v1', v1Routes(deps));

  app.use('/admin/*', (c, next) =>
    cors({ origin: c.env.ADMIN_ORIGIN, allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], maxAge: 600 })(c, next),
  );
  app.route('/admin', adminRoutes(deps));
  return app;
}

const app = createApp();

/** HTTP via Hono; the daily cron (wrangler.jsonc triggers) runs the cleanup. */
export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runCleanup(env, Date.now()).then((r) => console.log('cleanup', JSON.stringify(r))));
  },
} satisfies ExportedHandler<Env>;
