import { useMemo } from 'react';
import { useApp } from '../../state/app';
import { useInvCtx } from '../inventory/useInvCtx';
import type { SalesCtx, SalesSettings } from '../../domain/sales/sales';
import type { PurchaseCtx } from '../../domain/purchases/purchases';
import type { VoucherCtx } from '../../domain/vouchers/vouchers';

export function useSalesSettings(): SalesSettings {
  const s = useApp((x) => x.settings);
  return useMemo(
    () => ({ pricesIncludeVat: s.pricesIncludeVat ?? true, vatRegistered: s.vatRegistered ?? false, vatRateBp: s.vatRateBp ?? 0, cashRoundingMinor: s.cashRoundingMinor ?? 0, requireShift: s.requireShift ?? false }),
    [s.pricesIncludeVat, s.vatRegistered, s.vatRateBp, s],
  );
}

export function useSalesCtx(): SalesCtx | null {
  const inv = useInvCtx();
  const settings = useSalesSettings();
  return useMemo(() => (inv ? { ...inv, settings } : null), [inv, settings]);
}

/** Context for every Phase 4 write (purchases, vouchers, shifts, parties). */
export function useBizCtx(): (SalesCtx & PurchaseCtx & VoucherCtx) | null {
  const sales = useSalesCtx();
  return useMemo(() => (sales ? { ...sales, vatRegistered: sales.settings.vatRegistered, vatRateBp: sales.settings.vatRateBp, requireShift: !!sales.settings.requireShift } : null), [sales]);
}
