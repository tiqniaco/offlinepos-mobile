import ar from './ar.json';
import en from './en.json';

function keys(o: object, p = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
}

describe('translations', () => {
  it('Arabic and English have exactly the same keys', () => {
    expect(keys(ar).sort()).toEqual(keys(en).sort());
  });
  it('every API error code has an Arabic message', () => {
    const { API_ERROR_CODES } = require('@daftarak/shared');
    const needed = ['invalid_phone', 'otp_cooldown', 'otp_rate_limited', 'otp_invalid', 'otp_expired', 'otp_too_many_attempts', 'otp_send_failed'];
    needed.forEach((c) => expect(API_ERROR_CODES).toContain(c));
    needed.forEach((c) => expect((ar.errors as Record<string, string>)[c]).toBeTruthy());
  });
  it('copy uses Latin digits only (owner decision D-21)', () => {
    expect(JSON.stringify(ar)).not.toMatch(/[\u0660-\u0669\u06F0-\u06F9]/);
  });
  it('app name is Arabic by default', () => {
    expect(ar.app.name).toBe('كاشيرو');
  });
});
