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
  ocrListResponseSchema,
  ocrUsageSchema,
  type OcrMediaType,
  paymentRequestListSchema,
  type ApiErrorCode,
  type CreatePaymentRequest,
  type BackupMeta,
  backupPutSchema,
  type DeviceInfo,
  followShopResponseSchema,
  getSnapshotResponseSchema,
  putSnapshotResponseSchema,
  shopDevicesResponseSchema,
  type ShopSnapshot,
  syncInviteResponseSchema,
  syncJoinResponseSchema,
  syncOpsPushResponseSchema,
  syncOpsPullResponseSchema,
  syncStatusResponseSchema,
  syncCatalogPutResponseSchema,
} from '@daftarak/shared';
import { API_URL } from '../config/env';

type Integrity = { platform: 'android' | 'ios'; token: string; requestHash: string; keyId?: string };

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode | 'network',
    message: string,
    public readonly retryAfterMs?: number,
    /** limit_reached: {key, limit, used} from the server. */
    public readonly details?: { key?: string; limit?: number; used?: number },
  ) {
    super(message);
  }
}

async function request<T extends z.ZodType>(path: string, schema: T, init: { method?: string; body?: unknown; token?: string; timeoutMs?: number; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<z.infer<T>> {
  let res: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
    // The caller can cancel too (e.g. «إلغاء» while an invoice is being read).
    if (init.signal) {
      if (init.signal.aborted) ctrl.abort();
      else init.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}), ...init.headers },
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
    if (err.success) {
      const x = err.data.error;
      throw new ApiError(x.code as ApiErrorCode, x.message, x.retryAfterMs, x.key != null ? { key: x.key, limit: x.limit, used: x.used } : undefined);
    }
    throw new ApiError('internal', `HTTP ${res.status}`);
  }
  return schema.parse(json);
}

function toApiError(json: unknown, status: number): ApiError {
  const err = apiErrorSchema.safeParse(json);
  if (err.success) {
    const x = err.data.error;
    return new ApiError(x.code as ApiErrorCode, x.message, x.retryAfterMs, x.key != null ? { key: x.key, limit: x.limit, used: x.used } : undefined);
  }
  return new ApiError('internal', `HTTP ${status}`);
}

export const api = {
  requestOtp: (phone: string, locale: 'ar' | 'en') =>
    request('/v1/auth/otp/request', z.object({ phone: z.string(), resendAfterMs: z.number(), expiresInMs: z.number() }), {
      body: { phone, purpose: 'login', locale },
    }),
  /** Sign-up: does this number already have an account with a shop? */
  checkPhone: (phone: string) => request('/v1/auth/phone/check', z.object({ phone: z.string(), exists: z.boolean(), hasPassword: z.boolean() }), { body: { phone } }),
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
  stepUpRequest: (token: string) => request('/v1/auth/step-up/request', z.object({ phone: z.string().optional(), resendAfterMs: z.number(), expiresInMs: z.number() }), { body: {}, token }),
  /** Deletes the account and all its server data (needs a fresh step-up on this session). */
  deleteAccount: (token: string) => request('/v1/account/delete', z.object({ ok: z.literal(true), deletedBusinesses: z.number() }), { body: {}, token }),
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
  scanInvoice: (token: string, businessId: string, file: string, mediaType: OcrMediaType, opts: { signal?: AbortSignal; idempotencyKey?: string } = {}) =>
    request('/v1/purchases/scan', ocrScanResponseSchema, {
      body: { businessId, file, mediaType },
      token,
      timeoutMs: 120_000,
      signal: opts.signal,
      // Same key within 10 minutes → the server returns the stored result (a retry is never charged twice).
      headers: opts.idempotencyKey ? { 'X-Idempotency-Key': opts.idempotencyKey } : undefined,
    }),
  /** Any list of the shop's items (stock list / notebook / price list): same quota and protections as an invoice scan. */
  scanList: (token: string, businessId: string, file: string, mediaType: OcrMediaType, opts: { signal?: AbortSignal; idempotencyKey?: string } = {}) =>
    request('/v1/purchases/scan', ocrListResponseSchema, {
      body: { businessId, file, mediaType, mode: 'list' },
      token,
      timeoutMs: 120_000,
      signal: opts.signal,
      headers: opts.idempotencyKey ? { 'X-Idempotency-Key': opts.idempotencyKey } : undefined,
    }),
  scanUsage: (token: string, businessId: string) => request(`/v1/purchases/scan/usage?businessId=${encodeURIComponent(businessId)}`, ocrUsageSchema, { token }),
  sessions: (token: string) =>
    request('/v1/sessions', z.object({ sessions: z.array(z.object({ id: z.string(), created_at: z.number(), last_used_at: z.number().nullable(), platform: z.string().nullable(), model: z.string().nullable(), app_version: z.string().nullable(), current: z.boolean() })) }), { token }),
  /** «موبايل متابعة»: this phone follows the shop read-only (needs a fresh SMS step-up; counts as a phone of the plan). */
  followShop: (token: string, businessId: string, device: DeviceInfo, integrity?: Integrity) => request('/v1/devices/follow', followShopResponseSchema, { body: { businessId, device, integrity }, token }),
  /** Main phone → latest summary for the follower phones. followers = 0: nothing stored. */
  putSnapshot: (token: string, b: { businessId: string; deviceId: string; snapshot: ShopSnapshot }) => request('/v1/snapshot', putSnapshotResponseSchema, { body: b, token }),
  getSnapshot: (token: string, businessId: string, deviceId: string) =>
    request(`/v1/snapshot?businessId=${encodeURIComponent(businessId)}&deviceId=${encodeURIComponent(deviceId)}`, getSnapshotResponseSchema, { token }),
  shopDevices: (token: string, businessId: string) => request(`/v1/devices?businessId=${encodeURIComponent(businessId)}`, shopDevicesResponseSchema, { token }),
  stopDevice: (token: string, businessId: string, id: string) => request(`/v1/devices/${encodeURIComponent(id)}/stop`, z.object({ ok: z.boolean() }), { body: { businessId }, token }),
  // ── Multi-user on one shop (cashier phones by QR) ──
  syncInvite: (token: string, businessId: string, deviceId: string) => request('/v1/sync/invite', syncInviteResponseSchema, { body: { businessId, deviceId }, token }),
  syncJoin: (code: string, device: DeviceInfo, integrity?: Integrity) => request('/v1/sync/join', syncJoinResponseSchema, { body: { code, device, integrity } }),
  syncStatus: (token: string, deviceId: string) => request(`/v1/sync/status?deviceId=${encodeURIComponent(deviceId)}`, syncStatusResponseSchema, { token }),
  syncPushOps: (token: string, deviceId: string, ops: { seq: number; data: string }[]) => request('/v1/sync/ops', syncOpsPushResponseSchema, { body: { deviceId, ops }, token, timeoutMs: 45_000 }),
  syncPullOps: (token: string, businessId: string, deviceId: string) =>
    request(`/v1/sync/ops?businessId=${encodeURIComponent(businessId)}&deviceId=${encodeURIComponent(deviceId)}`, syncOpsPullResponseSchema, { token, timeoutMs: 45_000 }),
  syncAckOps: (token: string, businessId: string, deviceId: string, ids: number[]) => request('/v1/sync/ops/ack', z.object({ ok: z.boolean() }), { body: { businessId, deviceId, ids }, token }),
  /** Sealed catalog (binary). */
  syncPutCatalog: async (token: string, businessId: string, deviceId: string, blob: Uint8Array) => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1/sync/catalog`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream', 'X-Business-Id': businessId, 'X-Device-Id': deviceId }, body: blob as unknown as BodyInit });
    } catch (e) {
      throw new ApiError('network', (e as Error).message);
    }
    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) throw toApiError(json, res.status);
    return syncCatalogPutResponseSchema.parse(json);
  },
  syncGetCatalog: async (token: string, deviceId: string): Promise<{ version: number; blob: Uint8Array }> => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}/v1/sync/catalog?deviceId=${encodeURIComponent(deviceId)}`, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      throw new ApiError('network', (e as Error).message);
    }
    if (!res.ok) throw toApiError(await res.json().catch(() => null), res.status);
    return { version: Number(res.headers.get('X-Catalog-Version') ?? 0), blob: new Uint8Array(await res.arrayBuffer()) };
  },
  revokeSession: (token: string, id: string) => request(`/v1/sessions/${id}`, z.object({ ok: z.boolean() }), { method: 'DELETE', token }),
};
