/**
 * Typed client for the Worker API. Every response is validated with the shared Zod schemas.
 * The app works offline: callers must treat NetworkError as "try later", never as failure of daily work.
 */
import { z } from 'zod';
import {
  apiErrorSchema,
  authResponseSchema,
  checkinResponseSchema,
  createBusinessResponseSchema,
  type ApiErrorCode,
  type DeviceInfo,
} from '@daftarak/shared';
import { API_URL } from '../config/env';

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode | 'network', message: string, public readonly retryAfterMs?: number) {
    super(message);
  }
}

async function request<T extends z.ZodType>(path: string, schema: T, init: { method?: string; body?: unknown; token?: string } = {}): Promise<z.infer<T>> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch (e) {
    throw new ApiError('network', (e as Error).message);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = apiErrorSchema.safeParse(json);
    if (err.success) throw new ApiError(err.data.error.code as ApiErrorCode, err.data.error.message, err.data.error.retryAfterMs);
    throw new ApiError('internal', `HTTP ${res.status}`);
  }
  return schema.parse(json);
}

export const api = {
  requestOtp: (phone: string, locale: 'ar' | 'en') =>
    request('/v1/auth/otp/request', z.object({ phone: z.string(), resendAfterMs: z.number(), expiresInMs: z.number() }), {
      body: { phone, purpose: 'login', locale },
    }),
  verifyOtp: (phone: string, code: string, device: DeviceInfo) => request('/v1/auth/otp/verify', authResponseSchema, { body: { phone, code, device } }),
  createBusiness: (
    token: string,
    b: { name: string; country: 'EG' | 'SA'; type: 'shop' | 'trading'; vatRegistered: boolean; backupKey: string; device: DeviceInfo },
  ) => request('/v1/businesses', createBusinessResponseSchema, { body: b, token }),
  attachDevice: (token: string, businessId: string, device: DeviceInfo) =>
    request('/v1/devices/attach', createBusinessResponseSchema, { body: { businessId, device }, token }),
  checkin: (b: { refreshToken: string; deviceId: string; appVersion: string; deviceTime: number }) =>
    request('/v1/checkin', checkinResponseSchema, { body: b }),
};
