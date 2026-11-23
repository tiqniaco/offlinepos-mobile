/** The last item-list scan (photo of a stock list), handed from the quick-add hub to the list review screen. */
import { create } from 'zustand';
import type { OcrListResponse } from '@daftarak/shared';

export const useListScan = create<{ result: OcrListResponse | null; set: (r: OcrListResponse | null) => void }>((set) => ({
  result: null,
  set: (result) => set({ result }),
}));
