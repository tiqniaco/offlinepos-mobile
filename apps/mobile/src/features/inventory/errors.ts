import type { TFunction } from 'i18next';
import { InventoryError } from '../../domain/inventory/context';
import { errorMessage } from '../../lib/errors';
import { qty } from '../../lib/format';

export function invErrorMessage(t: TFunction, e: unknown): string {
  if (e instanceof InventoryError) {
    const d = { ...(e.detail ?? {}) } as Record<string, unknown>;
    if (typeof d.available === 'number') d.available = qty(d.available);
    return t(`invErrors.${e.code}`, d);
  }
  return errorMessage(t, e);
}
