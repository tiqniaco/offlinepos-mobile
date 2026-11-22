import { describe, expect, it } from 'vitest';
import { normalizeDigits, digitsOnly, normalizeArabicForSearch } from '../src/text';
import { normalizePhone, countryOfPhone } from '../src/phone';

describe('digits (D-21)', () => {
  it('converts Arabic-Indic and Persian digits to Latin', () => {
    expect(normalizeDigits('١٢٣٤٥٦٧٨٩٠')).toBe('1234567890');
    expect(normalizeDigits('۱۲۳')).toBe('123');
    expect(normalizeDigits('١٢٫٥')).toBe('12.5');
    expect(normalizeDigits('abc 12')).toBe('abc 12');
    expect(digitsOnly('٠١٠ ١٢٣-٤٥٦٧٨')).toBe('01012345678');
  });
});

describe('Arabic search normalisation', () => {
  it('unifies common spelling variants', () => {
    expect(normalizeArabicForSearch('أحمد')).toBe(normalizeArabicForSearch('احمد'));
    expect(normalizeArabicForSearch('مكتبة')).toBe(normalizeArabicForSearch('مكتبه'));
    expect(normalizeArabicForSearch('مصطفى')).toBe(normalizeArabicForSearch('مصطفي'));
    expect(normalizeArabicForSearch('مُحَمَّد')).toBe('محمد');
    expect(normalizeArabicForSearch('شـــاي')).toBe('شاي');
  });
});

describe('phone', () => {
  it('normalises EG and SA mobiles', () => {
    expect(normalizePhone('01012345678')).toBe('201012345678');
    expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toBe('201012345678');
    expect(normalizePhone('+20 101 234 5678')).toBe('201012345678');
    expect(normalizePhone('0501234567')).toBe('966501234567');
    expect(normalizePhone('00966501234567')).toBe('966501234567');
    expect(normalizePhone('501234567', 'SA')).toBe('966501234567');
  });
  it('rejects other numbers', () => {
    expect(normalizePhone('0131234567')).toBeNull();
    expect(normalizePhone('+447911123456')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
  });
  it('detects country', () => {
    expect(countryOfPhone('201012345678')).toBe('EG');
    expect(countryOfPhone('966501234567')).toBe('SA');
  });
});
