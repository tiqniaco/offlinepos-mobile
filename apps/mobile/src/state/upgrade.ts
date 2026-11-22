/** "Upgrade" sheet shown when the free plan hits a limit or a feature is missing (PLAN.md §8.2, D-20). */
import { create } from 'zustand';

export const useUpgrade = create<{ reason: string | null; show: (r: string) => void; hide: () => void }>((set) => ({
  reason: null,
  show: (reason) => set({ reason }),
  hide: () => set({ reason: null }),
}));
