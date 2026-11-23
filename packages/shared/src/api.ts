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
  account: z.object({ id: z.string(), phone: z.string(), hasPassword: z.boolean().default(false) }),
  businesses: z.array(businessSummarySchema),
});

/** Phone + password login (any phone). */
export const passwordLoginSchema = z.object({
  phone: z.string().min(6).max(20),
  password: z.string().min(1).max(128),
  device: deviceInfoSchema,
});

/** Set / change the account password: right after an SMS code (new account, forgot password) or with the current one. */
export const passwordSetSchema = z.object({
  password: z.string().min(1).max(128),
  currentPassword: z.string().max(128).optional(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

/** Play Integrity token (Android) or App Attest object (iOS) bound to requestHash. */
export const integritySchema = z.object({ platform: z.enum(['android', 'ios']), token: z.string().max(20_000), requestHash: z.string().max(128), keyId: z.string().max(200).optional() });

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  country: z.enum(['EG', 'SA']),
  type: z.enum(['shop', 'trading']),
  vatRegistered: z.boolean(),
  /** Backup key generated on device, base64url, 32 bytes (PLAN.md D-15). */
  backupKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  device: deviceInfoSchema,
  integrity: integritySchema.optional(),
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

export const attachDeviceSchema = z.object({ businessId: z.string(), device: deviceInfoSchema, integrity: integritySchema.optional() });

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
  /** A backup file is ready on the phone → the response carries a presigned PUT URL (PLAN.md §9.3). */
  backupMeta: z.lazy(() => backupMetaSchema).optional(),
  /** The upload of this backup finished → the server verifies and commits it. */
  committedBackupId: z.string().optional(),
  integrity: integritySchema.optional(),
  /** Expo push token of this phone (sent when it changes). */
  pushToken: z.string().max(200).optional(),
});

export const backupMetaSchema = z.object({
  size: z.number().int().positive().max(2_000_000_000),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  counts: z.record(z.string(), z.number().int()).default({}),
  schemaVersion: z.number().int().min(0),
});
export type BackupMeta = z.infer<typeof backupMetaSchema>;

export const backupUploadSchema = z.object({ businessId: z.string(), deviceId: z.string(), meta: backupMetaSchema, kind: z.enum(['auto', 'manual']).default('manual') });

export const backupPutSchema = z.object({ backupId: z.string(), url: z.string(), headers: z.record(z.string(), z.string()), expiresAt: z.number() });
export type BackupPut = z.infer<typeof backupPutSchema>;

export const checkinResponseSchema = z.object({
  licence: z.string(),
  serverTime: z.number(),
  refreshToken: z.string(),
  accessToken: z.string(),
  accessExpiresAt: z.number(),
  anchorReceipt: z
    .object({ chainSeq: z.number(), chainHead: z.string(), auditSeq: z.number(), auditHead: z.string(), serverTime: z.number(), sig: z.string() })
    .nullable(),
  backupPut: backupPutSchema.nullable().optional(),
  backupCommitted: z.boolean().optional(),
  notices: z.array(z.object({ kind: z.string(), textAr: z.string(), textEn: z.string() })),
  /** Super-admin announcements for the in-app inbox. */
  announcements: z.array(z.object({ id: z.string(), titleAr: z.string(), bodyAr: z.string(), titleEn: z.string().nullable(), bodyEn: z.string().nullable(), url: z.string().nullable(), at: z.number() })).optional(),
});
export type CheckinResponse = z.infer<typeof checkinResponseSchema>;

// ── Manual payments (InstaPay / Vodafone Cash + receipt photo; activated by the super admin) ──
export const MANUAL_PAYMENT_METHODS = ['instapay', 'vodafone_cash'] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];
export const BILLING_PERIODS = ['monthly', 'yearly'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];
export const PAYMENT_REQUEST_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];
/** Max decoded receipt image size (JPEG / PNG). */
export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024;

export const manualBillingInfoSchema = z.object({
  methods: z.array(z.object({ id: z.enum(MANUAL_PAYMENT_METHODS), number: z.string() })),
  slaHours: z.number(),
  plans: z.array(
    z.object({
      code: z.string(),
      nameAr: z.string(),
      nameEn: z.string(),
      monthlyMinor: z.number(),
      yearlyMinor: z.number(),
      limits: z.record(z.string(), z.number()),
      features: z.array(z.string()),
    }),
  ),
});
export type ManualBillingInfo = z.infer<typeof manualBillingInfoSchema>;

export const createPaymentRequestSchema = z.object({
  businessId: z.string(),
  plan: z.string().min(1).max(20),
  period: z.enum(BILLING_PERIODS),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  /** Egyptian mobile (01xxxxxxxxx; +20 / spaces accepted). */
  payerPhone: z.string().min(10).max(20),
  note: z.string().max(200).optional(),
  /** Receipt photo, base64 (a `data:image/...;base64,` prefix is accepted). */
  receipt: z.string().min(8).max(Math.ceil((RECEIPT_MAX_BYTES * 4) / 3) + 100),
});
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

export const createPaymentRequestResponseSchema = z.object({ id: z.string(), status: z.enum(PAYMENT_REQUEST_STATUSES), amountMinor: z.number(), createdAt: z.number() });
export type CreatePaymentRequestResponse = z.infer<typeof createPaymentRequestResponseSchema>;

export const paymentRequestSummarySchema = z.object({
  id: z.string(),
  plan: z.string(),
  period: z.enum(BILLING_PERIODS),
  amountMinor: z.number(),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  status: z.enum(PAYMENT_REQUEST_STATUSES),
  rejectReason: z.string().nullable(),
  createdAt: z.number(),
  reviewedAt: z.number().nullable(),
});
export type PaymentRequestSummary = z.infer<typeof paymentRequestSummarySchema>;
export const paymentRequestListSchema = z.object({ requests: z.array(paymentRequestSummarySchema) });

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
  'step_up_required',
  'code_invalid',
  'code_used',
  'backup_not_uploaded',
  'integrity_failed',
  'invalid_credentials',
  'password_locked',
  'password_weak',
  'password_not_set',
  'receipt_invalid',
  'too_many_pending',
  'rate_limited',
  'not_pending',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
