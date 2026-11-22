import { CURRENCIES, formatMinor, formatQty } from '@daftarak/shared';

/** Display formatting. Latin digits everywhere (owner decision D-21). */
export function dateLabel(lang: string, d = new Date()) {
  return d.toLocaleDateString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function dateTimeLabel(lang: string, ms: number) {
  return new Date(ms).toLocaleString(lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}


/** "22.00 ج.م" / "SAR 22.00". Latin digits always (D-21). */
export function money(minor: number, currency: 'EGP' | 'SAR' = 'EGP', lang = 'ar'): string {
  const c = CURRENCIES[currency];
  return lang === 'en' ? `${c.symbolEn} ${formatMinor(minor)}` : `${formatMinor(minor)} ${c.symbolAr}`;
}

export const qty = (milli: number) => formatQty(milli);
