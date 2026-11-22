/**
 * Bridge between screens and the full-screen scanner route.
 * A screen registers what to do with each code; the scanner calls it and shows the returned message.
 * Hardware (keyboard-wedge) scanners don't use this — they type into the focused search/barcode field.
 */
import { create } from 'zustand';

export interface ScanRequest {
  continuous: boolean;
  /** Return a short message to show (e.g. product name), or null. */
  onCode: (code: string) => Promise<string | null> | string | null;
}

interface ScannerState {
  request: ScanRequest | null;
  set: (r: ScanRequest | null) => void;
}

export const useScanner = create<ScannerState>((set) => ({ request: null, set: (request) => set({ request }) }));
