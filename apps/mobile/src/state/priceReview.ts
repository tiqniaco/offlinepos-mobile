/** Count of products waiting for a sale-price review (badge on the products tab). */
import { create } from 'zustand';
import { getDb } from '../db/client';
import { countNeedsPriceReview } from '../domain/inventory/products';

export const usePriceReview = create<{ count: number }>(() => ({ count: 0 }));

export async function refreshPriceReview(): Promise<void> {
  try {
    usePriceReview.setState({ count: await countNeedsPriceReview(getDb()) });
  } catch {
    /* badge only */
  }
}
