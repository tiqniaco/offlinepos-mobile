import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; onPress: () => void };
}

interface ToastState {
  toast: Toast | null;
  show: (t: Omit<Toast, 'id'>, ms?: number) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** One snackbar at a time (e.g. "deleted — undo"). Rendered once in the root layout. */
export const useToast = create<ToastState>((set) => ({
  toast: null,
  show: (t, ms = 4000) => {
    if (timer) clearTimeout(timer);
    set({ toast: { ...t, id: Date.now() } });
    timer = setTimeout(() => set({ toast: null }), ms);
  },
  hide: () => set({ toast: null }),
}));

export const toast = (text: string, tone: Toast['tone'] = 'success', action?: Toast['action']) => useToast.getState().show({ text, tone, action }, action ? 6000 : 3000);
