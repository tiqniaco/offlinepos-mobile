/**
 * Request/response schemas for the Worker API (`/v1`). Shared by the Worker (validation) and the
 * mobile client (typed calls + response validation). See docs/api.md.
 */
import { z } from 'zod';

export const OTP_POLICY = {
  digits: 6,
  ttlMs: 5 * 60_000,
  maxAttempts: 5,
  resendCooldownMs: 60_000,
  maxPerPhonePerHour: 5,
  maxPerPhonePerDay: 10,
  maxPerIpPerHour: 20,
} as const;

export const TOKEN_POLICY = {
  accessTtlMs: 15 * 60_000,
  refreshTtlMs: 90 * 86_400_000,
  stepUpTtlMs: 10 * 60_000,
} as const;

export const deviceInfoSchema = z.object({
  installId: z.string().min(8).max(64),
  platform: z.enum(['android', 'ios']),
  model: z.string().max(80).optional(),
  appVersion: z.string().max(20),
});
export type DeviceInfo = z.infer<typeof deviceInfoSchema>;

export const otpRequestSchema = z.object({
  phone: z.string().min(6).max(20),
  purpose: z.enum(['login', 'step_up']).default('login'),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export const otpVerifySchema = z.object({
  phone: z.string().min(6).max(20),
  code: z.string().regex(/^\d{6}$/),
  device: deviceInfoSchema,
});

export const businessSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  country: z.enum(['EG', 'SA']),
  type: z.enum(['shop', 'trading']),
  role: z.enum(['owner']),
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  account: z.object({ id: z.string(), phone: z.string() }),
  businesses: z.array(businessSummarySchema),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  country: z.enum(['EG', 'SA']),
  type: z.enum(['shop', 'trading']),
  vatRegistered: z.boolean(),
  /** Backup key generated on device, base64url, 32 bytes (PLAN.md D-15). */
  backupKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  device: deviceInfoSchema,
});

export const deviceRegistrationSchema = z.object({
  businessId: z.string(),
  deviceId: z.string(),
  deviceCode: z.string(),
  licence: z.string(),
  serverTime: z.number(),
});

export const createBusinessResponseSchema = z.object({
  business: businessSummarySchema,
  registration: deviceRegistrationSchema,
});
export type CreateBusinessResponse = z.infer<typeof createBusinessResponseSchema>;

export const attachDeviceSchema = z.object({ businessId: z.string(), device: deviceInfoSchema });

export const anchorSchema = z.object({
  chainSeq: z.number().int().min(0),
  chainHead: z.string().regex(/^[0-9a-f]{64}$/),
  auditSeq: z.number().int().min(0),
  auditHead: z.string().regex(/^[0-9a-f]{64}$/),
});

export const checkinSchema = z.object({
  refreshToken: z.string(),
  deviceId: z.string(),
  appVersion: z.string().max(20),
  deviceTime: z.number().int(),
  anchor: anchorSchema.optional(),
});

export const checkinResponseSchema = z.object({
  licence: z.string(),
  serverTime: z.number(),
  refreshToken: z.string(),
  accessToken: z.string(),
  accessExpiresAt: z.number(),
  anchorReceipt: z
    .object({ chainSeq: z.number(), chainHead: z.string(), auditSeq: z.number(), auditHead: z.string(), serverTime: z.number(), sig: z.string() })
    .nullable(),
  notices: z.array(z.object({ kind: z.string(), textAr: z.string(), textEn: z.string() })),
});
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), retryAfterMs: z.number().optional() }),
});

/** Error codes the app translates into Arabic messages. */
export const API_ERROR_CODES = [
  'invalid_request',
  'invalid_phone',
  'otp_cooldown',
  'otp_rate_limited',
  'otp_invalid',
  'otp_expired',
  'otp_too_many_attempts',
  'otp_send_failed',
  'unauthorized',
  'session_revoked',
  'device_deactivated',
  'forbidden',
  'not_found',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
