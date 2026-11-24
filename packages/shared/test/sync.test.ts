import { describe, expect, it } from 'vitest';
import { catalogAad, joinQr, newSyncKey, openSync, opAad, parseJoinQr, sealSync } from '../src/sync';

describe('shop sync sealing', () => {
  it('round-trips, and fails with another key, shop or op', () => {
    const k = newSyncKey();
    const v = { a: 1, name: 'شاي', list: Array.from({ length: 200 }, (_, i) => i) };
    const blob = sealSync(k, v, catalogAad('b1'));
    expect(openSync(k, blob, catalogAad('b1'))).toEqual(v);
    expect(() => openSync(newSyncKey(), blob, catalogAad('b1'))).toThrow();
    expect(() => openSync(k, blob, catalogAad('b2'))).toThrow();
    const op = sealSync(k, v, opAad('b1', 'd1', 1));
    expect(() => openSync(k, op, opAad('b1', 'd1', 2))).toThrow();
    // Two seals of the same value differ (random nonce).
    expect(sealSync(k, v, 'x')).not.toEqual(sealSync(k, v, 'x'));
  });

  it('join QR: only our format, valid code and key', () => {
    const k = newSyncKey();
    expect(parseJoinQr(joinQr('ABCDEFGH2345', k))).toEqual({ code: 'ABCDEFGH2345', syncKey: k });
    expect(parseJoinQr('https://example.com')).toBeNull();
    expect(parseJoinQr(`kashiro-join:1:abc:${k}`)).toBeNull();
    expect(parseJoinQr('kashiro-join:1:ABCDEFGH2345:short')).toBeNull();
  });
});
