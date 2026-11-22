/**
 * Country & business-type profiles (PLAN.md §3.6). Onboarding copies the merged profile into the
 * local `settings` table; the app reads settings, never these constants directly, so a business can
 * override anything later. Nothing country-specific is hard-coded elsewhere.
 */
import type { CountryCode } from './phone';

export type BusinessType = 'shop' | 'trading';

export interface PaymentMethodDef {
  key: 'cash' | 'card' | 'wallet' | 'bank' | 'credit';
  /** For wallets, the names shown as quick choices. */
  wallets?: string[];
}

export interface CountryProfile {
  country: CountryCode;
  currency: 'EGP' | 'SAR';
  timezone: string;
  vatRateBp: number;
  vatLabelAr: string;
  vatLabelEn: string;
  invoiceTitleAr: string;
  invoiceTitleEn: string;
  zatcaQr: boolean;
  wallets: string[];
  taxNumberLabelAr: string;
}

export const COUNTRY_PROFILES: Record<CountryCode, CountryProfile> = {
  EG: {
    country: 'EG',
    currency: 'EGP',
    timezone: 'Africa/Cairo',
    vatRateBp: 1400,
    vatLabelAr: 'ضريبة القيمة المضافة',
    vatLabelEn: 'VAT',
    invoiceTitleAr: 'فاتورة',
    invoiceTitleEn: 'Invoice',
    zatcaQr: false,
    wallets: ['فودافون كاش', 'إنستاباي', 'اتصالات كاش', 'أورنج كاش'],
    taxNumberLabelAr: 'رقم التسجيل الضريبي',
  },
  SA: {
    country: 'SA',
    currency: 'SAR',
    timezone: 'Asia/Riyadh',
    vatRateBp: 1500,
    vatLabelAr: 'ضريبة القيمة المضافة',
    vatLabelEn: 'VAT',
    invoiceTitleAr: 'فاتورة ضريبية مبسطة',
    invoiceTitleEn: 'Simplified Tax Invoice',
    zatcaQr: true,
    wallets: ['STC Pay', 'Apple Pay', 'مدى'],
    taxNumberLabelAr: 'الرقم الضريبي',
  },
};

export interface TypeProfile {
  type: BusinessType;
  /** Q-15: VAT-inclusive prices for shops, exclusive for trading companies. */
  pricesIncludeVat: boolean;
  defaultPriceTier: 'retail' | 'wholesale';
  homeFocus: 'pos' | 'documents';
  creditSalesProminent: boolean;
}

export const TYPE_PROFILES: Record<BusinessType, TypeProfile> = {
  shop: { type: 'shop', pricesIncludeVat: true, defaultPriceTier: 'retail', homeFocus: 'pos', creditSalesProminent: false },
  trading: {
    type: 'trading',
    pricesIncludeVat: false,
    defaultPriceTier: 'wholesale',
    homeFocus: 'documents',
    creditSalesProminent: true,
  },
};

/** The settings written at onboarding. Keys are stable; values are JSON. */
export interface BusinessSettings {
  country: CountryCode;
  businessType: BusinessType;
  currency: 'EGP' | 'SAR';
  timezone: string;
  vatRegistered: boolean;
  vatNumber: string | null;
  vatRateBp: number;
  pricesIncludeVat: boolean;
  defaultPriceTier: 'retail' | 'wholesale';
  invoiceTitleAr: string;
  zatcaQr: boolean;
  wallets: string[];
  negativeStock: 'warn' | 'block';
  autoLockMinutes: number;
  homeFocus: 'pos' | 'documents';
}

export function buildInitialSettings(input: {
  country: CountryCode;
  type: BusinessType;
  vatRegistered: boolean;
  vatNumber?: string | null;
}): BusinessSettings {
  const c = COUNTRY_PROFILES[input.country];
  const t = TYPE_PROFILES[input.type];
  return {
    country: c.country,
    businessType: t.type,
    currency: c.currency,
    timezone: c.timezone,
    vatRegistered: input.vatRegistered,
    vatNumber: input.vatRegistered ? (input.vatNumber ?? null) : null,
    vatRateBp: input.vatRegistered ? c.vatRateBp : 0,
    pricesIncludeVat: t.pricesIncludeVat,
    defaultPriceTier: t.defaultPriceTier,
    invoiceTitleAr: input.vatRegistered ? c.invoiceTitleAr : 'فاتورة',
    zatcaQr: input.vatRegistered && c.zatcaQr,
    wallets: c.wallets,
    negativeStock: 'warn',
    autoLockMinutes: 5,
    homeFocus: t.homeFocus,
  };
}

/** Business day (yyyymmdd) in the business time zone — never UTC (PLAN.md D-17, R-12). */
export function businessDay(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    new Date(epochMs),
  );
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return Number(get('year') + get('month') + get('day'));
}
