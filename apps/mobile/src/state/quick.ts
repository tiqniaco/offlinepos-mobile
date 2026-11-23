import { create } from 'zustand';

/** The center «+» quick-actions sheet. */
export const useQuick = create<{ open: boolean; show: () => void; hide: () => void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
