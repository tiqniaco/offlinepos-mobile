import { useMemo } from 'react';
import { useApp } from '../../state/app';
import { useInvCtx } from '../inventory/useInvCtx';
import type { SalesCtx, SalesSettings } from '../../domain/sales/sales';

export function useSalesSettings(): SalesSettings {
  const s = useApp((x) => x.settings);
  return useMemo(
    () => ({ pricesIncludeVat: s.pricesIncludeVat ?? true, vatRegistered: s.vatRegistered ?? false, vatRateBp: s.vatRateBp ?? 0, cashRoundingMinor: (s as { cashRoundingMinor?: number }).cashRoundingMinor ?? 0 }),
    [s.pricesIncludeVat, s.vatRegistered, s.vatRateBp, s],
  );
}

export function useSalesCtx(): SalesCtx | null {
  const inv = useInvCtx();
  const settings = useSalesSettings();
  return useMemo(() => (inv ? { ...inv, settings } : null), [inv, settings]);
}
