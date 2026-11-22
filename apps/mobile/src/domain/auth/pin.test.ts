import { checkPin, hashPin, isValidPin, isWeakPin, lockoutAfterFailure, normalizePinInput } from './pin';

const FAST = { N: 2 ** 4, r: 8, p: 1 };

describe('PIN rules', () => {
  it('accepts 4–6 digits only', () => {
    expect(isValidPin('1357')).toBe(true);
    expect(isValidPin('135790')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('1234567')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
  });
  it('rejects weak PINs', () => {
    expect(isWeakPin('0000')).toBe(true);
    expect(isWeakPin('1234')).toBe(true);
    expect(isWeakPin('987654')).toBe(true);
    expect(isWeakPin('2580')).toBe(false);
  });
  it('converts Arabic digits while typing (D-21)', () => {
    expect(normalizePinInput('١٣٥٧')).toBe('1357');
    expect(normalizePinInput('12345678')).toBe('123456');
  });
});

describe('PIN hashing', () => {
  it('verifies the right PIN only and never stores it in clear', async () => {
    const h = await hashPin('2580', undefined, FAST);
    expect(h.hash).not.toContain('2580');
    const user = { pinHash: h.hash, pinSalt: h.salt, pinParams: h.params };
    expect(await checkPin('2580', user)).toBe(true);
    expect(await checkPin('2581', user)).toBe(false);
  });
  it('uses a random salt', async () => {
    const a = await hashPin('2580', undefined, FAST);
    const b = await hashPin('2580', undefined, FAST);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe('lock-out', () => {
  it('allows 5 tries, then 30 s doubling up to 15 min', () => {
    expect(lockoutAfterFailure(4, 0)).toBeNull();
    expect(lockoutAfterFailure(5, 0)).toBe(30_000);
    expect(lockoutAfterFailure(6, 0)).toBe(60_000);
    expect(lockoutAfterFailure(20, 0)).toBe(15 * 60_000);
  });
});
