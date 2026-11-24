/**
 * Multi-device phase 1: «موبايل متابعة» — the owner follows the shop from a second phone (read-only).
 * The main phone pushes a small summary (this snapshot) when something changed and a follower phone exists;
 * the follower downloads it. No invoices or customer data beyond names on the short lists below.
 */
import { z } from 'zod';
import { deviceInfoSchema, integritySchema } from './api';

/** Max stored snapshot size (JSON bytes). */
export const SNAPSHOT_MAX_BYTES = 48 * 1024;
/** The main phone pushes at most this often (server-enforced too). */
export const SNAPSHOT_MIN_INTERVAL_MS = 5 * 60_000;

const money = z.number().int();
export const shopSnapshotSchema = z.object({
  v: z.literal(1),
  /** Phone time when built (ms). */
  at: z.number().int(),
  /** Business day (YYYYMMDD) the "today" figures belong to. */
  day: z.number().int(),
  currency: z.string().max(3),
  today: z.object({
    salesMinor: money,
    invoices: z.number().int(),
    returnsMinor: money,
    profitMinor: money,
    expensesMinor: money,
    /** Money received today by method (cash, card, wallet, bank). */
    byMethod: z.array(z.object({ method: z.string().max(10), amountMinor: money })).max(6),
  }),
  yesterdaySalesMinor: money,
  month: z.object({ salesMinor: money, profitMinor: money, expensesMinor: money, purchasesMinor: money }),
  receivablesMinor: money,
  payablesMinor: money,
  stock: z.object({ valueMinor: money, low: z.number().int(), out: z.number().int() }),
  /** Open shifts (cashier, opened at, expected cash now). */
  shifts: z.array(z.object({ user: z.string().max(60), openedAt: z.number().int(), expectedCashMinor: money })).max(5),
  last14: z.array(z.object({ day: z.number().int(), salesMinor: money })).max(14),
  top: z.array(z.object({ name: z.string().max(80), qtyMilli: z.number().int(), salesMinor: money })).max(8),
  lowItems: z.array(z.object({ name: z.string().max(80), qtyMilli: z.number().int() })).max(15),
  recent: z
    .array(
      z.object({
        no: z.string().max(30).nullable(),
        type: z.enum(['INVOICE', 'RETURN']),
        status: z.enum(['POSTED', 'VOIDED']),
        at: z.number().int(),
        totalMinor: money,
        party: z.string().max(80).nullable(),
        cashier: z.string().max(60).nullable(),
      }),
    )
    .max(20),
});
export type ShopSnapshot = z.infer<typeof shopSnapshotSchema>;

export const followShopSchema = z.object({ businessId: z.string(), device: deviceInfoSchema, integrity: integritySchema.optional() });
export const followShopResponseSchema = z.object({
  business: z.object({ id: z.string(), name: z.string(), country: z.enum(['EG', 'SA']), type: z.enum(['shop', 'trading']) }),
  deviceId: z.string(),
  deviceCode: z.string(),
});
export type FollowShopResponse = z.infer<typeof followShopResponseSchema>;

export const putSnapshotSchema = z.object({ businessId: z.string(), deviceId: z.string(), snapshot: shopSnapshotSchema });
export const putSnapshotResponseSchema = z.object({ ok: z.boolean(), followers: z.number().int() });

export const getSnapshotResponseSchema = z.object({
  snapshot: shopSnapshotSchema.nullable(),
  /** Server time the snapshot was received. */
  receivedAt: z.number().nullable(),
  /** Last time the main phone was online (check-in or snapshot). */
  mainSeenAt: z.number().nullable(),
  businessName: z.string(),
  serverTime: z.number(),
});
export type GetSnapshotResponse = z.infer<typeof getSnapshotResponseSchema>;

export const shopDevicesResponseSchema = z.object({
  limit: z.number().int(),
  devices: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      role: z.enum(['main', 'follower']),
      model: z.string().nullable(),
      platform: z.string().nullable(),
      activatedAt: z.number(),
      lastSeenAt: z.number().nullable(),
      current: z.boolean(),
    }),
  ),
});
export type ShopDevicesResponse = z.infer<typeof shopDevicesResponseSchema>;
