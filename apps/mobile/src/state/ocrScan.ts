/** The last supplier-invoice scan result, handed from the purchase screen to the review screen. */
import { create } from 'zustand';
import { onSessionEnd } from './app';
import type { OcrScanResponse } from '@daftarak/shared';

export const useOcrScan = create<{ result: OcrScanResponse | null; set: (r: OcrScanResponse | null) => void }>((set) => ({
  result: null,
  set: (result) => set({ result }),
}));

// A photographed list / invoice is the signed-in user's work: dropped when the app locks or the user changes.
onSessionEnd(() => useOcrScan.setState({ result: null }));

/** "Add as new product" from the review: the product form reports the new id here, then goes back. */
let newProductHandler: ((productId: string) => void) | null = null;
export function onNextNewProduct(f: ((productId: string) => void) | null) {
  newProductHandler = f;
}
/** Called by the product form after a create; returns true when a scan review was waiting for it. */
export function reportNewProduct(productId: string): boolean {
  const f = newProductHandler;
  newProductHandler = null;
  f?.(productId);
  return !!f;
}
