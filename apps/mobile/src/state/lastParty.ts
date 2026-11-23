import { create } from 'zustand';
import type { PartyRow, PartyType } from '../domain/parties/parties';

/**
 * Hand-off slot for "new party" from a PartyPicker: the picker opens the form with a key, the form puts
 * the created party here under that key and goes back, and the picker (on focus) takes it and selects it.
 */
interface LastPartyState {
  pendingKey: string | null;
  result: { key: string; type: PartyType; row: PartyRow } | null;
  begin: () => string;
  put: (type: PartyType, row: PartyRow) => void;
  take: (key: string, type: PartyType) => PartyRow | null;
}

export const useLastParty = create<LastPartyState>((set, get) => ({
  pendingKey: null,
  result: null,
  begin: () => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set({ pendingKey: key, result: null });
    return key;
  },
  put: (type, row) => {
    const key = get().pendingKey;
    if (key) set({ result: { key, type, row }, pendingKey: null });
  },
  take: (key, type) => {
    const r = get().result;
    if (!r || r.key !== key || r.type !== type) return null;
    set({ result: null });
    return r.row;
  },
}));
