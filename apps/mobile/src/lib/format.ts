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

/** Left-to-right isolate (U+2066 … U+2069): keeps numbers, phones and codes intact inside Arabic text. */
export const ltr = (s: string) => `⁦${s}⁩`;

/**
 * One way to show a phone everywhere: Egyptian mobiles in the local form people know ("01012345678"), Saudi
 * ones as "0501234567"; anything else as "+<digits>". `isolate` wraps it for use inside RTL text.
 * Accepts the stored E.164 form without "+" ("201012345678"), with "+", or a local number.
 */
export function phoneLabel(intl: string | null | undefined, opts: { isolate?: boolean } = {}): string {
  if (!intl) return '';
  const d = intl.replace(/[^\d]/g, '');
  let out: string;
  if (/^20(10|11|12|15)\d{8}$/.test(d)) out = `0${d.slice(2)}`;
  else if (/^9665\d{8}$/.test(d)) out = `0${d.slice(3)}`;
  else if (/^0\d{8,}$/.test(d)) out = d;
  else out = d ? `+${d}` : intl.trim();
  return opts.isolate ? ltr(out) : out;
}

/**
 * Money with the sign kept visually in front of the number in RTL ("-58.40 ج.م" instead of "58.40- ج.م"):
 * the numeric part is LTR-isolated.
 */
export function signedMoney(minor: number, currency: 'EGP' | 'SAR' = 'EGP', lang = 'ar'): string {
  const c = CURRENCIES[currency];
  const n = ltr(formatMinor(minor));
  return lang === 'en' ? `${c.symbolEn} ${n}` : `${n} ${c.symbolAr}`;
}

/** Any number as text that may be negative, isolated so the minus stays on the left in RTL tables. */
export const signedText = (s: string) => (/^[-−]/.test(s.trim()) ? ltr(s.trim()) : s);
