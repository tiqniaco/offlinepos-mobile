import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './env';
import { ApiError, errorResponse } from './lib/http';
import { defaultDeps, v1Routes, type Deps } from './routes/v1';
import { adminRoutes } from './admin/routes';

export function createApp(deps: Deps = defaultDeps) {
  const app = new Hono<AppEnv>();

  app.onError((err, c) => {
    if (err instanceof ApiError) return errorResponse(c, err);
    console.error(err);
    return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: 'not_found', message: 'not found' } }, 404));

  app.get('/health', (c) => c.json({ ok: true }));

  // The mobile app is not a browser: no CORS on /v1.
  app.route('/v1', v1Routes(deps));

  app.use('/admin/*', (c, next) =>
    cors({ origin: c.env.ADMIN_ORIGIN, allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PUT', 'DELETE'], maxAge: 600 })(c, next),
  );
  app.route('/admin', adminRoutes(deps));
  return app;
}

const app = createApp();
export default app;
