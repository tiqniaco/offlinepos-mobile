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
  createPaymentRequestResponseSchema,
  manualBillingInfoSchema,
  ocrScanResponseSchema,
  ocrUsageSchema,
  type OcrMediaType,
  paymentRequestListSchema,
  type ApiErrorCode,
  type CreatePaymentRequest,
  type BackupMeta,
  backupPutSchema,
  type DeviceInfo,
} from '@daftarak/shared';
import { API_URL } from '../config/env';

type Integrity = { platform: 'android' | 'ios'; token: string; requestHash: string; keyId?: string };

export class ApiError extends Error {
  constructor(public readonly code: ApiErrorCode | 'network', message: string, public readonly retryAfterMs?: number) {
    super(message);
  }
}

async function request<T extends z.ZodType>(path: string, schema: T, init: { method?: string; body?: unknown; token?: string; timeoutMs?: number } = {}): Promise<z.infer<T>> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
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
  passwordLogin: (phone: string, password: string, device: DeviceInfo) => request('/v1/auth/password/login', authResponseSchema, { body: { phone, password, device } }),
  setPassword: (token: string, password: string, currentPassword?: string) =>
    request('/v1/auth/password/set', z.object({ ok: z.boolean() }), { body: { password, currentPassword }, token }),
  createBusiness: (
    token: string,
    b: { name: string; country: 'EG' | 'SA'; type: 'shop' | 'trading'; vatRegistered: boolean; backupKey: string; device: DeviceInfo; integrity?: Integrity },
  ) => request('/v1/businesses', createBusinessResponseSchema, { body: b, token }),
  attachDevice: (token: string, businessId: string, device: DeviceInfo, integrity?: Integrity) =>
    request('/v1/devices/attach', createBusinessResponseSchema, { body: { businessId, device, integrity }, token }),
  checkin: (b: { refreshToken: string; deviceId: string; appVersion: string; deviceTime: number; anchor?: { chainSeq: number; chainHead: string; auditSeq: number; auditHead: string }; backupMeta?: BackupMeta; committedBackupId?: string; integrity?: Integrity; pushToken?: string }) =>
    request('/v1/checkin', checkinResponseSchema, { body: b }),
  refresh: (refreshToken: string) => request('/v1/auth/refresh', z.object({ accessToken: z.string(), refreshToken: z.string(), accessExpiresAt: z.number() }), { body: { refreshToken } }),
  stepUpRequest: (token: string) => request('/v1/auth/step-up/request', z.object({ phone: z.string(), resendAfterMs: z.number(), expiresInMs: z.number() }), { body: {}, token }),
  stepUpVerify: (token: string, code: string) => request('/v1/auth/step-up/verify', z.object({ stepUpUntil: z.number() }), { body: { code }, token }),
  backupUploadUrl: (token: string, b: { businessId: string; deviceId: string; meta: BackupMeta; kind: 'auto' | 'manual' }) => request('/v1/backups/upload-url', backupPutSchema, { body: b, token }),
  backupCommit: (token: string, id: string, businessId: string) => request(`/v1/backups/${id}/commit`, z.object({ ok: z.boolean() }), { body: { businessId }, token }),
  listBackups: (token: string, businessId: string) =>
    request(
      `/v1/backups?businessId=${encodeURIComponent(businessId)}`,
      z.object({ backups: z.array(z.object({ id: z.string(), size: z.number(), counts: z.record(z.string(), z.number().nullable()), schemaVersion: z.number(), kind: z.string(), at: z.number(), deviceCode: z.string().nullable(), model: z.string().nullable() })) }),
      { token },
    ),
  backupDownloadUrl: (token: string, id: string) => request(`/v1/backups/${id}/download-url`, z.object({ url: z.string(), sha256: z.string(), size: z.number() }), { body: {}, token }),
  backupKey: (token: string, businessId: string) => request('/v1/backups/key', z.object({ backupKey: z.string() }), { body: { businessId }, token }),
  activateDevice: (token: string, businessId: string, device: DeviceInfo, backupId?: string, integrity?: Integrity) => request('/v1/devices/activate', createBusinessResponseSchema, { body: { businessId, device, backupId, integrity }, token }),
  redeemCode: (token: string, businessId: string, code: string) => request('/v1/licence/activation-code', z.object({ plan: z.string(), expiresAt: z.number() }), { body: { businessId, code }, token }),
  /** Manual payment (InstaPay / Vodafone Cash): numbers, SLA and paid plan prices (EGP minor units). */
  billingInfo: (token: string, businessId: string) => request(`/v1/billing/manual/info?businessId=${encodeURIComponent(businessId)}`, manualBillingInfoSchema, { token }),
  /** Sends the receipt (base64 JPEG/PNG ≤ 2 MB). Errors: receipt_invalid, invalid_phone, too_many_pending (409), rate_limited (429). */
  createPaymentRequest: (token: string, payload: CreatePaymentRequest) => request('/v1/billing/manual/requests', createPaymentRequestResponseSchema, { body: payload, token, timeoutMs: 90_000 }),
  listPaymentRequests: (token: string, businessId: string) => request(`/v1/billing/manual/requests?businessId=${encodeURIComponent(businessId)}`, paymentRequestListSchema, { token }),
  /**
   * Supplier invoice scan (needs internet; counts against the plan's monthly `ocr_month` only when it succeeds).
   * Errors: ocr_not_in_plan (403), ocr_quota_exceeded (402), image_invalid / pdf_too_large (400), ocr_failed (422), ocr_unavailable (503), rate_limited (429).
   */
  scanInvoice: (token: string, businessId: string, file: string, mediaType: OcrMediaType) =>
    request('/v1/purchases/scan', ocrScanResponseSchema, { body: { businessId, file, mediaType }, token, timeoutMs: 120_000 }),
  scanUsage: (token: string, businessId: string) => request(`/v1/purchases/scan/usage?businessId=${encodeURIComponent(businessId)}`, ocrUsageSchema, { token }),
  sessions: (token: string) =>
    request('/v1/sessions', z.object({ sessions: z.array(z.object({ id: z.string(), created_at: z.number(), last_used_at: z.number().nullable(), platform: z.string().nullable(), model: z.string().nullable(), app_version: z.string().nullable(), current: z.boolean() })) }), { token }),
  revokeSession: (token: string, id: string) => request(`/v1/sessions/${id}`, z.object({ ok: z.boolean() }), { method: 'DELETE', token }),
};
