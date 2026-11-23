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
}

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
    limits: { users: 1, products: 100, parties: 50, invoices_month: 150, backups_kept: 3, ocr_month: 0 },
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
    limits: { users: 3, products: 3000, parties: UNLIMITED, invoices_month: 3000, backups_kept: 7, ocr_month: 30 },
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
    limits: { users: 10, products: UNLIMITED, parties: UNLIMITED, invoices_month: UNLIMITED, backups_kept: 30, ocr_month: 150 },
    features: ['no_ads', 'multi_unit', 'offers', 'expenses_shifts', 'expiry', 'adv_reports', 'custom_roles'],
    isFree: false,
    trialDays: 14,
  },
];

/** Plan given automatically at sign-up as a trial. */
export const TRIAL_PLAN_CODE = 'pro';
export const FREE_PLAN_CODE = 'free';

export function withinLimit(limit: number, current: number): boolean {
  return limit === UNLIMITED || current < limit;
}
