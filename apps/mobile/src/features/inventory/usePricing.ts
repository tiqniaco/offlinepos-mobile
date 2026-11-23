import { useEffect, useMemo, useState } from 'react';
import { getDb } from '../../db/client';
import { useApp } from '../../state/app';
import { pricingOf, type QuickPricing } from '../../domain/inventory/quickPricing';
import { productSlotsLeft } from '../../domain/inventory/products';

/** The shop's default markup and sale-price rounding (selling settings). */
export function usePricing(): QuickPricing {
  const markup = useApp((s) => s.settings.defaultMarkupBp);
  const step = useApp((s) => s.settings.priceRoundingMinor);
  return useMemo(() => pricingOf({ defaultMarkupBp: markup, priceRoundingMinor: step }), [markup, step]);
}

/** How many more products the plan allows (null = unlimited / not known yet). */
export function useProductSlots(): number | null {
  const limit = useApp((s) => s.licence?.limits.products);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void productSlotsLeft(getDb()).then(
      (n) => alive && setLeft(n),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [limit]);
  return left;
}
