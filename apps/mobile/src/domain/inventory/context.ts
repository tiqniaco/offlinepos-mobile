import type { Db } from '../../db/types';
import type { SessionUser } from '../auth/users';

/** Everything an inventory write needs. Built once per screen from the app store. */
export interface InvCtx {
  db: Db;
  user: SessionUser;
  device: { id: string; code: string };
  timezone: string;
  negativeStock: 'warn' | 'block';
  /** Plan features from the licence (multi_unit, expiry…). */
  features: readonly string[];
  now?: () => number;
}

export type InventoryErrorCode =
  | 'not_found'
  | 'name_required'
  | 'invalid_price'
  | 'invalid_qty'
  | 'barcode_taken'
  | 'sku_taken'
  | 'negative_blocked'
  | 'feature_unavailable'
  | 'unit_required'
  | 'empty_count';

export class InventoryError extends Error {
  constructor(
    public readonly code: InventoryErrorCode,
    public readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'InventoryError';
  }
}

export const nowOf = (ctx: Pick<InvCtx, 'now'>) => (ctx.now ? ctx.now() : Date.now());
