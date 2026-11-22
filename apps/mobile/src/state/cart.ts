/**
 * The current POS cart (UI state). Scanning the same item again increases its quantity and moves it
 * to the top (SPEC §5). Persisted only when parked (sales_docs PARKED) — see domain/sales.
 */
import { create } from 'zustand';
import type { Discount } from '@daftarak/shared';
import type { CartLine, SaleDraft } from '../domain/sales/sales';

interface CartState {
  lines: CartLine[];
  customerId: string | null;
  customerName: string | null;
  priceTier: 'retail' | 'wholesale';
  invoiceDiscount: Discount | null;
  note: string | null;
  /** Parked/quotation doc this cart came from (replaced when parked again / converted on sale). */
  sourceId: string | null;
  quotationId: string | null;
  lastAddedKey: string | null;
  add: (line: CartLine) => void;
  setQty: (key: string, qtyMilli: number) => void;
  update: (key: string, patch: Partial<CartLine>) => void;
  remove: (key: string) => void;
  setCustomer: (id: string | null, name: string | null, tier?: 'retail' | 'wholesale') => void;
  setInvoiceDiscount: (d: Discount | null) => void;
  load: (d: SaleDraft, sourceId: string | null) => void;
  clear: () => void;
  draft: () => SaleDraft;
}

const empty = { lines: [], customerId: null, customerName: null, priceTier: 'retail' as const, invoiceDiscount: null, note: null, sourceId: null, quotationId: null, lastAddedKey: null };

export const useCart = create<CartState>((set, get) => ({
  ...empty,
  add: (line) =>
    set((s) => {
      const existing = s.lines.find((l) => l.key === line.key);
      if (existing) {
        const others = s.lines.filter((l) => l.key !== line.key);
        return { lines: [...others, { ...existing, qtyMilli: existing.qtyMilli + line.qtyMilli }], lastAddedKey: line.key };
      }
      return { lines: [...s.lines, line], lastAddedKey: line.key };
    }),
  setQty: (key, qtyMilli) => set((s) => ({ lines: qtyMilli <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, qtyMilli } : l)) })),
  update: (key, patch) => set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) })),
  remove: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  setCustomer: (customerId, customerName, tier) => set((s) => ({ customerId, customerName, priceTier: tier ?? s.priceTier })),
  setInvoiceDiscount: (invoiceDiscount) => set({ invoiceDiscount }),
  load: (d, sourceId) => set({ ...empty, lines: d.lines, customerId: d.customerId ?? null, customerName: d.customerName ?? null, priceTier: d.priceTier, invoiceDiscount: d.invoiceDiscount ?? null, note: d.note ?? null, sourceId, quotationId: d.quotationId ?? null }),
  clear: () => set({ ...empty }),
  draft: () => {
    const s = get();
    return { lines: s.lines, customerId: s.customerId, customerName: s.customerName, priceTier: s.priceTier, invoiceDiscount: s.invoiceDiscount, note: s.note, quotationId: s.quotationId };
  },
}));
