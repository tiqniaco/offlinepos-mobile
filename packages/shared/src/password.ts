/**
 * Account password policy (owner login on any phone, offline unlock on this phone).
 * 8–64 characters, at least one letter (Arabic or Latin) and one digit, not a well-known weak password.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

const COMMON = new Set(['password1', 'password123', 'qwerty123', 'abc12345', 'abcd1234', '1234abcd', 'a1234567', 'aa123456', 'pass1234', 'admin123', 'daftarak1', 'daftarak123']);

export type PasswordProblem = 'short' | 'long' | 'letter' | 'digit' | 'common';

export function passwordProblem(pw: string): PasswordProblem | null {
  if (pw.length < PASSWORD_MIN) return 'short';
  if (pw.length > PASSWORD_MAX) return 'long';
  if (!/\p{L}/u.test(pw)) return 'letter';
  if (!/[0-9٠-٩]/.test(pw)) return 'digit';
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return 'common';
  return null;
}
