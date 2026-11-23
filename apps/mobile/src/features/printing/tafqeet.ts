/**
 * تفقيط — an amount written in Arabic words, as Egyptian invoices print it:
 *   125050 (minor) → «ألف ومائتان وخمسون جنيهاً وخمسون قرشاً».
 * Pure (no React / Expo) so it is unit-tested and used by the A4 template.
 */

const ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة'];
const TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const HUNDREDS = ['', 'مائة', 'مائتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];

/** 1..999 in words. */
function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]!);
  if (r) {
    if (r <= 10) parts.push(ONES[r]!);
    else if (r < 20) parts.push(TEENS[r - 10]!);
    else {
      const o = r % 10;
      parts.push(o ? `${ONES[o]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]!);
    }
  }
  return parts.join(' و');
}

/** A counted noun after a number: [one, two, plural (3-10), accusative singular (11-99), genitive singular]. */
type Noun = readonly [one: string, two: string, plural: string, acc: string, gen: string];

/** «ثلاثة آلاف», «أحد عشر ألفاً», «مائة ألف» … */
function counted(n: number, noun: Noun): string {
  if (n === 1) return noun[0];
  if (n === 2) return noun[1];
  const r = n % 100;
  const w = below1000(n);
  if (r >= 3 && r <= 10) return `${w} ${noun[2]}`;
  if (r >= 11) return `${w} ${noun[3]}`;
  return `${construct(w)} ${noun[4]}`;
}

/** Dual directly before its noun (إضافة) drops the nun: «مائتا ألف», «مائتا جنيه», «ألفا جنيه». */
const construct = (w: string) => (w.endsWith('ان') ? w.slice(0, -1) : w);

/** Above this the words are not written (no scale word beyond مليار): digits instead. */
const MAX_WORDS = 1e12;

const SCALES: { value: number; noun: Noun }[] = [
  { value: 1_000_000_000, noun: ['مليار', 'ملياران', 'مليارات', 'ملياراً', 'مليار'] },
  { value: 1_000_000, noun: ['مليون', 'مليونان', 'ملايين', 'مليوناً', 'مليون'] },
  { value: 1_000, noun: ['ألف', 'ألفان', 'آلاف', 'ألفاً', 'ألف'] },
];

/** A whole number in Arabic words (masculine counting). 0 / NaN → «صفر»; 10^12 and above → Latin digits. */
export function numberToArabicWords(value: number): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'صفر' : String(value);
  let n = Math.floor(Math.abs(value));
  if (n === 0) return 'صفر';
  if (n >= MAX_WORDS) return String(n);
  const parts: string[] = [];
  for (const s of SCALES) {
    const c = Math.floor(n / s.value);
    if (c) parts.push(counted(c, s.noun));
    n %= s.value;
  }
  if (n) parts.push(below1000(n));
  return parts.join(' و');
}

const POUND: Noun = ['جنيه', 'جنيهان', 'جنيهات', 'جنيهاً', 'جنيه'];
const PIASTRE: Noun = ['قرش', 'قرشان', 'قروش', 'قرشاً', 'قرش'];
const RIYAL: Noun = ['ريال', 'ريالان', 'ريالات', 'ريالاً', 'ريال'];

/** «جنيه واحد», «جنيهان», «ثلاثة جنيهات», «أحد عشر جنيهاً», «مائة جنيه», «مائة وخمسة جنيهات»… */
function money(n: number, noun: Noun): string {
  if (n === 1) return `${noun[0]} ${ONES[1]}`;
  if (n === 2) return noun[1];
  const r = n % 100;
  const w = numberToArabicWords(n);
  if (r >= 3 && r <= 10) return `${w} ${noun[2]}`;
  if (r >= 11) return `${w} ${noun[3]}`;
  return `${n >= MAX_WORDS ? w : construct(w)} ${noun[4]}`;
}

/**
 * Amount (minor units, 2 decimals) in Arabic words.
 * EGP: «ألف ومائتان وخمسون جنيهاً وخمسون قرشاً». SAR: riyals in words, halalas as «و50 هللة».
 */
export function amountInWordsAr(minor: number, currency: 'EGP' | 'SAR' = 'EGP'): string {
  const abs = Number.isFinite(minor) ? Math.round(Math.abs(minor)) : 0;
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const main = currency === 'SAR' ? RIYAL : POUND;
  if (whole === 0 && frac === 0) return `صفر ${main[0]}`;
  const parts: string[] = [];
  if (whole) parts.push(money(whole, main));
  if (frac) parts.push(currency === 'SAR' ? `${frac} هللة` : money(frac, PIASTRE));
  return parts.join(' و');
}
