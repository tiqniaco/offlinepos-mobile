/** The purchase invoice being entered (survives going to the scanner and back). */
import { create } from 'zustand';
import type { PurchaseLine } from '../domain/purchases/purchases';

interface PurchaseCartState {
  supplierId: string | null;
  supplierName: string | null;
  supplierRef: string;
  lines: PurchaseLine[];
  pricesIncludeVat: boolean;
  invoiceDiscountMinor: number;
  lastKey: string | null;
  add: (l: PurchaseLine) => void;
  update: (key: string, p: Partial<PurchaseLine>) => void;
  remove: (key: string) => void;
  set: (p: Partial<PurchaseCartState>) => void;
  clear: () => void;
}

const empty = { supplierId: null, supplierName: null, supplierRef: '', lines: [], pricesIncludeVat: false, invoiceDiscountMinor: 0, lastKey: null };

export const usePurchaseCart = create<PurchaseCartState>((set, get) => ({
  ...empty,
  add: (l) => {
    const ex = get().lines.find((x) => x.key === l.key);
    if (ex) set({ lines: [{ ...ex, qtyMilli: ex.qtyMilli + l.qtyMilli }, ...get().lines.filter((x) => x.key !== l.key)], lastKey: l.key });
    else set({ lines: [l, ...get().lines], lastKey: l.key });
  },
  update: (key, p) => set({ lines: get().lines.map((x) => (x.key === key ? { ...x, ...p } : x)) }),
  remove: (key) => set({ lines: get().lines.filter((x) => x.key !== key) }),
  set: (p) => set(p),
  clear: () => set(empty),
}));
