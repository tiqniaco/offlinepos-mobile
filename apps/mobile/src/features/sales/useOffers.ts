import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { businessDay } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { loadOffers } from '../../domain/offers/offers';
import { useApp } from '../../state/app';
import type { OfferCtx } from '../../domain/sales/sales';

/** Live offers for today's business day, reloaded whenever the screen gets focus. */
export function useOfferCtx(): OfferCtx {
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [oc, setOc] = useState<OfferCtx>({ offers: [], day: businessDay(Date.now(), tz) });
  useFocusEffect(
    useCallback(() => {
      void loadOffers(getDb()).then((offers) => setOc({ offers, day: businessDay(Date.now(), tz) }));
    }, [tz]),
  );
  return oc;
}
