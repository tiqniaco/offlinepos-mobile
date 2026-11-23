/**
 * «امسح الباركود وكمّل»: the pending list (known barcodes waiting for «خلّصت») and the run's progress. In memory
 * only (nothing persisted) and cleared when the app locks or another user signs in: one user's scans never post
 * under another's name.
 */
import { create } from 'zustand';
import { onSessionEnd } from './app';

export interface PendingScan {
  key: string;
  productId: string;
  productUnitId: string;
  name: string;
  unitName: string;
  qtyMilli: number;
}

export interface ScanAddState {
  pending: PendingScan[];
  /** Products created in this run (names, newest first) — shown so the user sees progress. */
  added: string[];
  lastUnit: string;
  lastCategoryId: string | null;
}

const EMPTY: ScanAddState = { pending: [], added: [], lastUnit: 'قطعة', lastCategoryId: null };

export const useScanAdd = create<ScanAddState>(() => ({ ...EMPTY }));

export const clearScanAdd = () => useScanAdd.setState({ ...EMPTY, pending: [], added: [] });

onSessionEnd(clearScanAdd);
