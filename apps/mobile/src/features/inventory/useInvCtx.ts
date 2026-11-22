import { useMemo } from 'react';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import type { InvCtx } from '../../domain/inventory/context';

/** Builds the inventory write context from the signed-in user, device, settings and licence. */
export function useInvCtx(): InvCtx | null {
  const user = useApp((s) => s.user);
  const device = useApp((s) => s.device);
  const settings = useApp((s) => s.settings);
  const features = useApp((s) => s.licence?.features);
  return useMemo(() => {
    if (!user || !device) return null;
    return {
      db: getDb(),
      user,
      device,
      timezone: settings.timezone ?? 'Africa/Cairo',
      negativeStock: settings.negativeStock ?? 'warn',
      features: features ?? [],
    };
  }, [user, device, settings.timezone, settings.negativeStock, features]);
}

export function useCurrency(): 'EGP' | 'SAR' {
  return useApp((s) => s.business?.currency ?? 'EGP');
}

export function useCan(p: string): boolean {
  return useApp((s) => !!s.user?.permissions.includes(p as never));
}
