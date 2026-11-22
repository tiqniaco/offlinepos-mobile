/**
 * Must be the first import of the app. Provides `crypto.getRandomValues` (used by UUIDv7 and @noble)
 * from the native secure RNG.
 */
import * as ExpoCrypto from 'expo-crypto';

const g = globalThis as unknown as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } };
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) {
  g.crypto.getRandomValues = (a: Uint8Array) => ExpoCrypto.getRandomValues(a);
}
