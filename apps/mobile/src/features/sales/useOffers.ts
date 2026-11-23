import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { businessDay } from '@daftarak/shared';
import { getDb } from '../../db/client';
import { loadOffers } from '../../domain/offers/offers';
import { useApp } from '../../state/app';
import type { OfferCtx } from '../../domain/sales/sales';

/**
 * Live offers for today's business day, reloaded whenever the screen gets focus.
 * `loaded` is false until the first load answers, so totals shown before it may still change.
 */
export function useOfferCtx(): OfferCtx & { loaded: boolean } {
  const tz = useApp((s) => s.settings.timezone ?? 'Africa/Cairo');
  const [oc, setOc] = useState<OfferCtx & { loaded: boolean }>(() => ({ offers: [], day: businessDay(Date.now(), tz), loaded: false }));
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadOffers(getDb()).then(
        (offers) => alive && setOc({ offers, day: businessDay(Date.now(), tz), loaded: true }),
        () => alive && setOc((o) => (o.loaded ? o : { ...o, loaded: true })),
      );
      return () => {
        alive = false;
      };
    }, [tz]),
  );
  return oc;
}
