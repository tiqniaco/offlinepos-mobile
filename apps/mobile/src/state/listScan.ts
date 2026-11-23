/** The last item-list scan (photo of a stock list), handed from the quick-add hub to the list review screen. */
import { create } from 'zustand';
import { onSessionEnd } from './app';
import type { OcrListResponse } from '@daftarak/shared';

export const useListScan = create<{ result: OcrListResponse | null; set: (r: OcrListResponse | null) => void }>((set) => ({
  result: null,
  set: (result) => set({ result }),
}));

// A photographed list / invoice is the signed-in user's work: dropped when the app locks or the user changes.
onSessionEnd(() => useListScan.setState({ result: null }));
