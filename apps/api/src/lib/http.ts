import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import type { ApiErrorCode } from '@daftarak/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: ApiErrorCode,
    message?: string,
    public readonly retryAfterMs?: number,
    /** Extra fields merged into the error body (e.g. limit_reached: {key, limit, used}). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
  }
}

export function errorResponse(c: Context, err: ApiError) {
  return c.json(
    { error: { ...(err.details ?? {}), code: err.code, message: err.message, ...(err.retryAfterMs != null ? { retryAfterMs: err.retryAfterMs } : {}) } },
    err.status,
  );
}

/** Parse & validate a JSON body with a Zod schema; throws ApiError(400) on failure. */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_request', 'body must be JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(400, 'invalid_request', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

export function clientIp(c: Context): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}
