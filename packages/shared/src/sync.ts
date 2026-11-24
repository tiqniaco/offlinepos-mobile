/**
 * Multi-user on one shop (phones of the same shop): a cashier phone joins by QR, sells offline, and its sales reach
 * the shop's main phone through the server; the main phone sends the catalog (products, prices, customers, users…)
 * back. Everything the server stores is sealed with the shop's SYNC KEY (AES-256-GCM): the key travels only inside
 * the QR, phone to phone, so the server never reads the shop's data.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { gunzipSync, gzipSync } from 'fflate';
import { z } from 'zod';
import { base64urlDecode, base64urlEncode, utf8Decode, utf8ToBytes } from './crypto';
import { deviceInfoSchema, integritySchema } from './api';

export const SYNC_KEY_BYTES = 32;
/** Max sealed catalog size (bytes). */
export const SYNC_CATALOG_MAX_BYTES = 8 * 1024 * 1024;
/** Max sealed op size (one sale). */
export const SYNC_OP_MAX_BYTES = 64 * 1024;
export const SYNC_OPS_PER_PUSH = 50;
export const SYNC_INVITE_TTL_MS = 15 * 60_000;

export const newSyncKey = (): string => base64urlEncode(randomBytes(SYNC_KEY_BYTES));

/** gzip + AES-256-GCM. Output: 12-byte nonce || ciphertext. `aad` binds the blob to its shop and purpose. */
export function sealSync(keyB64: string, value: unknown, aad: string): Uint8Array {
  const key = base64urlDecode(keyB64);
  if (key.length !== SYNC_KEY_BYTES) throw new Error('bad sync key');
  const nonce = randomBytes(12);
  const ct = gcm(key, nonce, utf8ToBytes(aad)).encrypt(gzipSync(utf8ToBytes(JSON.stringify(value)), { level: 6 }));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce, 0);
  out.set(ct, 12);
  return out;
}

export function openSync<T = unknown>(keyB64: string, blob: Uint8Array, aad: string): T {
  const key = base64urlDecode(keyB64);
  const pt = gcm(key, blob.subarray(0, 12), utf8ToBytes(aad)).decrypt(blob.subarray(12));
  return JSON.parse(utf8Decode(gunzipSync(pt))) as T;
}

export const catalogAad = (businessId: string) => `kashiro-catalog:${businessId}`;
export const opAad = (businessId: string, deviceId: string, seq: number) => `kashiro-op:${businessId}:${deviceId}:${seq}`;

/** QR content: "kashiro-join:1:<code>:<syncKey>". */
export const JOIN_QR_PREFIX = 'kashiro-join:1:';
export function joinQr(code: string, syncKey: string): string {
  return `${JOIN_QR_PREFIX}${code}:${syncKey}`;
}
export function parseJoinQr(text: string): { code: string; syncKey: string } | null {
  const t = text.trim();
  if (!t.startsWith(JOIN_QR_PREFIX)) return null;
  const [code, key] = t.slice(JOIN_QR_PREFIX.length).split(':');
  if (!code || !key || !/^[A-Z0-9]{10,16}$/.test(code) || !/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  return { code, syncKey: key };
}

// ── API shapes ──
export const syncInviteSchema = z.object({ businessId: z.string(), deviceId: z.string() });
export const syncInviteResponseSchema = z.object({ code: z.string(), expiresAt: z.number() });

export const syncJoinSchema = z.object({ code: z.string().regex(/^[A-Z0-9]{10,16}$/), device: deviceInfoSchema, integrity: integritySchema.optional() });
export const syncJoinResponseSchema = z.object({
  business: z.object({ id: z.string(), name: z.string(), country: z.enum(['EG', 'SA']), type: z.enum(['shop', 'trading']) }),
  deviceId: z.string(),
  deviceCode: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  licence: z.string(),
  serverTime: z.number(),
});
export type SyncJoinResponse = z.infer<typeof syncJoinResponseSchema>;

export const syncOpsPushSchema = z.object({
  deviceId: z.string(),
  ops: z.array(z.object({ seq: z.number().int().min(1), data: z.string().max(Math.ceil((SYNC_OP_MAX_BYTES * 4) / 3) + 4) })).min(1).max(SYNC_OPS_PER_PUSH),
});
export const syncOpsPushResponseSchema = z.object({ stored: z.number().int(), appliedSeq: z.number().int() });

export const syncStatusResponseSchema = z.object({
  catalogVersion: z.number().int(),
  /** Highest op seq of this phone that the shop phone has applied. */
  appliedSeq: z.number().int(),
  serverTime: z.number(),
});

export const syncOpsPullResponseSchema = z.object({
  ops: z.array(z.object({ id: z.number().int(), deviceId: z.string(), deviceCode: z.string(), seq: z.number().int(), data: z.string() })),
  more: z.boolean(),
});
export type SyncPulledOp = z.infer<typeof syncOpsPullResponseSchema>['ops'][number];

export const syncCatalogPutResponseSchema = z.object({ version: z.number().int(), satellites: z.number().int() });
