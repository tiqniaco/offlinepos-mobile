/**
 * Plans, limits and feature flags (PLAN.md §17.1). Values here are only the SEED;
 * the live values are edited in super admin and travel to the phone inside the signed licence.
 */

export const FEATURES = [
  'no_ads',
  'multi_unit',
  'offers',
  'expenses_shifts',
  'expiry',
  'adv_reports',
  'custom_roles',
] as const;
export type Feature = (typeof FEATURES)[number];

export interface PlanLimits {
  /** -1 = unlimited */
  users: number;
  products: number;
  parties: number;
  invoices_month: number;
  backups_kept: number;
  /** Supplier-invoice photo scans (OCR) per calendar month. 0 = not in the plan. Old licences without it read as 0. */
  ocr_month: number;
  /*
   * Usage limits added later (usage metering). Optional: licences signed before they existed do not carry them —
   * the app treats a missing one as unlimited for display; the server always enforces (plan defaults when a stored
   * plan row lacks the key). Per-business overrides (super admin) replace the plan value.
   */
  /** OTP SMS sends per business per Cairo day. */
  sms_day?: number;
  /** Cloud (R2) backup storage per business in MB. 0 = no cloud backup (use the folder backup on the phone). */
  backup_storage_mb?: number;
  /** Manual-payment receipt uploads per business per Cairo month. */
  receipt_uploads_month?: number;
  /** Authenticated app API requests per business per Cairo day (soft: /checkin is never blocked). */
  api_requests_day?: number;
  /** Active phones per business (for multi-device). */
  devices?: number;
}

/** Limit keys that are metered and enforced by the server (and can be overridden per business). */
export const USAGE_LIMIT_KEYS = ['sms_day', 'backup_storage_mb', 'receipt_uploads_month', 'api_requests_day', 'devices', 'ocr_month', 'backups_kept'] as const;
export type UsageLimitKey = (typeof USAGE_LIMIT_KEYS)[number];
/** Every limit key (plan editor / overrides). */
export const LIMIT_KEYS = ['users', 'products', 'parties', 'invoices_month', 'backups_kept', 'ocr_month', 'sms_day', 'backup_storage_mb', 'receipt_uploads_month', 'api_requests_day', 'devices'] as const satisfies readonly (keyof PlanLimits)[];
export type LimitKey = (typeof LIMIT_KEYS)[number];

export interface PlanDefinition {
  code: string;
  nameAr: string;
  nameEn: string;
  /** Prices in minor units per currency; 0 = free. */
  monthly: { EGP: number; SAR: number };
  yearly: { EGP: number; SAR: number };
  limits: PlanLimits;
  features: Feature[];
  isFree: boolean;
  trialDays: number;
}

export const UNLIMITED = -1;

export const DEFAULT_PLANS: PlanDefinition[] = [
  {
    code: 'free',
    nameAr: 'مجاني',
    nameEn: 'Free',
    monthly: { EGP: 0, SAR: 0 },
    yearly: { EGP: 0, SAR: 0 },
    limits: { users: 1, products: 100, parties: 50, invoices_month: 150, backups_kept: 3, ocr_month: 0, sms_day: 5, backup_storage_mb: 0, receipt_uploads_month: 5, api_requests_day: 2000, devices: 1 },
    features: [],
    isFree: true,
    trialDays: 0,
  },
  {
    code: 'basic',
    nameAr: 'أساسي',
    nameEn: 'Basic',
    monthly: { EGP: 14_900, SAR: 3_900 },
    yearly: { EGP: 149_000, SAR: 39_000 },
    limits: { users: 3, products: 3000, parties: UNLIMITED, invoices_month: 3000, backups_kept: 7, ocr_month: 30, sms_day: 10, backup_storage_mb: 150, receipt_uploads_month: 10, api_requests_day: 5000, devices: 2 },
    features: ['no_ads', 'multi_unit', 'offers', 'expenses_shifts'],
    isFree: false,
    trialDays: 0,
  },
  {
    code: 'pro',
    nameAr: 'احترافي',
    nameEn: 'Pro',
    monthly: { EGP: 29_900, SAR: 7_900 },
    yearly: { EGP: 299_000, SAR: 79_000 },
    limits: { users: 10, products: UNLIMITED, parties: UNLIMITED, invoices_month: UNLIMITED, backups_kept: 30, ocr_month: 150, sms_day: 20, backup_storage_mb: 1024, receipt_uploads_month: 20, api_requests_day: 15000, devices: 5 },
    // custom_roles stays a known feature (old licences carry it) but is not offered: the feature is not built.
    features: ['no_ads', 'multi_unit', 'offers', 'expenses_shifts', 'expiry', 'adv_reports'],
    isFree: false,
    trialDays: 14,
  },
];

/** Plan given automatically at sign-up as a trial. */
export const TRIAL_PLAN_CODE = 'pro';
export const FREE_PLAN_CODE = 'free';

/** A missing limit (older licence) counts as unlimited here: the server enforces it. */
export function withinLimit(limit: number | undefined, current: number): boolean {
  return limit == null || limit === UNLIMITED || current < limit;
}

/** Seed defaults for the usage limits of a plan code (unknown paid plans get basic, unknown free plans get free). */
export function defaultUsageLimits(code: string, isFree: boolean): Required<Pick<PlanLimits, 'sms_day' | 'backup_storage_mb' | 'receipt_uploads_month' | 'api_requests_day' | 'devices'>> {
  const p = DEFAULT_PLANS.find((x) => x.code === code) ?? DEFAULT_PLANS.find((x) => x.code === (isFree ? FREE_PLAN_CODE : 'basic'))!;
  const l = p.limits;
  return { sms_day: l.sms_day!, backup_storage_mb: l.backup_storage_mb!, receipt_uploads_month: l.receipt_uploads_month!, api_requests_day: l.api_requests_day!, devices: l.devices! };
}
