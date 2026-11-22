import { digitsOnly } from './text';

export type CountryCode = 'EG' | 'SA';

export const COUNTRY_DIAL: Record<CountryCode, string> = { EG: '20', SA: '966' };

/**
 * Normalise a mobile number to E.164 without "+", e.g. "01012345678" (EG) → "201012345678",
 * "0501234567" (SA) → "966501234567". Returns null if it is not a valid mobile number for the country.
 * Only EG and SA numbers are accepted (OTP country allow-list, PLAN.md §11.3).
 */
export function normalizePhone(raw: string, country?: CountryCode): string | null {
  let d = digitsOnly(raw);
  if (d.startsWith('00')) d = d.slice(2);
  // Already international?
  if (d.startsWith('20') && /^20(10|11|12|15)\d{8}$/.test(d)) return d;
  if (d.startsWith('966') && /^9665\d{8}$/.test(d)) return d;
  if (country === 'EG' || (!country && d.startsWith('01'))) {
    if (/^01(0|1|2|5)\d{8}$/.test(d)) return '20' + d.slice(1);
    if (/^1(0|1|2|5)\d{8}$/.test(d)) return '20' + d;
  }
  if (country === 'SA' || (!country && d.startsWith('05'))) {
    if (/^05\d{8}$/.test(d)) return '966' + d.slice(1);
    if (/^5\d{8}$/.test(d)) return '966' + d;
  }
  return null;
}

export function countryOfPhone(e164: string): CountryCode | null {
  if (e164.startsWith('20')) return 'EG';
  if (e164.startsWith('966')) return 'SA';
  return null;
}
