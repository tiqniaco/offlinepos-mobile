import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Hex, chainHash, GENESIS_HASH, base64urlDecode, base64urlEncode, utf8Decode, utf8ToBytes } from '../src/crypto';
import { uuidv7, isUuid, uuidv7Time, HybridLogicalClock, parseHlc } from '../src/ids';
import { totpCode, verifyTotp, base32Encode, base32Decode } from '../src/totp';

describe('canonicalJson', () => {
  it('sorts keys, drops undefined, keeps null, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: undefined, d: { z: 0, y: -1 } })).toBe('{"a":[true,null,"x"],"b":1,"d":{"y":-1,"z":0}}');
  });
  it('rejects floats', () => {
    expect(() => canonicalJson({ a: 1.5 })).toThrow();
  });
  it('NFC-normalises strings', () => {
    expect(canonicalJson('é')).toBe(canonicalJson('é'));
  });
  it('is independent of key insertion order', () => {
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
});

describe('hashing', () => {
  it('sha256 known vector', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('chain hash depends on payload and previous hash', () => {
    const h1 = chainHash({ n: 1 }, GENESIS_HASH);
    const h2 = chainHash({ n: 2 }, h1);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(chainHash({ n: 2 }, h1)).toBe(h2);
    expect(chainHash({ n: 2 }, GENESIS_HASH)).not.toBe(h2);
    expect(() => chainHash({}, 'nothex')).toThrow();
  });
});

describe('base64url & utf8', () => {
  it('round trips arbitrary bytes and Arabic text', () => {
    for (let len = 0; len < 40; len++) {
      const b = new Uint8Array(len).map((_, i) => (i * 37 + len) & 0xff);
      expect(base64urlDecode(base64urlEncode(b))).toEqual(b);
    }
    const s = 'دفترك ✓ 😀 abc';
    expect(utf8Decode(utf8ToBytes(s))).toBe(s);
  });
});

describe('uuidv7', () => {
  it('is a valid, time-ordered UUID', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7());
    ids.forEach((id) => expect(isUuid(id)).toBe(true));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.abs(uuidv7Time(ids[0]!) - Date.now())).toBeLessThan(5000);
  });
});

describe('HLC', () => {
  it('is monotonic even when the wall clock goes back', () => {
    let t = 1000;
    const c = new HybridLogicalClock('A', () => t);
    const a = c.tick();
    t = 500;
    const b = c.tick();
    expect(b > a).toBe(true);
    const merged = c.receive('0000000009999-0003-B');
    expect(parseHlc(merged).ms).toBe(9999);
    expect(parseHlc(merged).counter).toBe(4);
  });
});

describe('TOTP (RFC 6238 vectors, SHA-1)', () => {
  const secret = base32Encode(utf8ToBytes('12345678901234567890'));
  it.each([
    [59_000, '287082'], [1_111_111_109_000, '081804'], [1_234_567_890_000, '005924'], [2_000_000_000_000, '279037'],
  ])('at %i → %s', (t, code) => expect(totpCode(secret, t)).toBe(code));
  it('verifies within ±1 step only', () => {
    const now = 1_700_000_000_000;
    const code = totpCode(secret, now);
    expect(verifyTotp(secret, code, now + 30_000)).not.toBeNull();
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(base32Decode(base32Encode(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]));
  });
});
