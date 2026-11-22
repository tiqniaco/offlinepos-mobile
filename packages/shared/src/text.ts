/**
 * Digit and Arabic text normalisation.
 *
 * Owner decision (PLAN.md D-21): users may type Arabic-Indic (٠-٩) or Persian (۰-۹) digits;
 * they are converted to Latin digits as they type. Display and print use Latin digits.
 */

const ARABIC_INDIC_ZERO = 0x0660; // ٠
const PERSIAN_ZERO = 0x06f0; // ۰

/** Convert Arabic-Indic / Persian digits to Latin and Arabic decimal/thousands separators to "." / ",". */
export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const c = ch.codePointAt(0)!;
    if (c >= ARABIC_INDIC_ZERO && c <= ARABIC_INDIC_ZERO + 9) out += String(c - ARABIC_INDIC_ZERO);
    else if (c >= PERSIAN_ZERO && c <= PERSIAN_ZERO + 9) out += String(c - PERSIAN_ZERO);
    else if (ch === '٫') out += '.'; // Arabic decimal separator ٫
    else if (ch === '٬') out += ','; // Arabic thousands separator ٬
    else out += ch;
  }
  return out;
}

/** Keep only Latin digits (after normalisation). Used for PIN, OTP and phone inputs. */
export function digitsOnly(input: string): string {
  return normalizeDigits(input).replace(/\D+/g, '');
}

/**
 * Normalise Arabic text for search (FTS index and query must use the same function):
 * strips tashkeel and tatweel, unifies alef forms, taa marbuta → haa, alef maqsura → yaa, lowercases Latin.
 */
export function normalizeArabicForSearch(input: string): string {
  return normalizeDigits(input)
    .normalize('NFC')
    .replace(/[ً-ٰٟۖ-ۭ]/g, '') // harakat / tashkeel
    .replace(/ـ/g, '') // tatweel
    .replace(/[آأإٱ]/g, 'ا') // آ أ إ ٱ → ا
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي') // ئ → ي
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
