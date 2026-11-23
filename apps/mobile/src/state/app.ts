/**
 * UI state only (Zustand). The database stays the source of truth; this mirrors what screens need.
 */
import { create } from 'zustand';
import type { AuthResponse, CreateBusinessResponse, LicenceState } from '@daftarak/shared';
import type { SessionUser } from '../domain/auth/users';
import type { AppSettings } from '../domain/settings/settings';
import type { BusinessForm } from '../domain/onboarding';

export type AppStatus = 'booting' | 'fatal' | 'onboarding' | 'locked' | 'ready';

export interface BusinessInfo {
  name: string;
  country: 'EG' | 'SA';
  type: 'shop' | 'trading';
  currency: 'EGP' | 'SAR';
  /** Server-side business id (backups, billing). */
  serverBusinessId: string;
}

interface AppState {
  status: AppStatus;
  fatal: 'db_not_encrypted' | 'db_open_failed' | 'boot_failed' | null;
  /** Technical detail of the start-up failure (shown small on the fatal screen, sent with a report). */
  fatalDetail: string | null;
  device: { id: string; code: string } | null;
  business: BusinessInfo | null;
  settings: Partial<AppSettings>;
  licence: LicenceState | null;
  user: SessionUser | null;
  lastActivity: number;
  /** Changes when new messages from Daftarak arrive (home bell refreshes). */
  inboxBump: number;
  /** Bumped after any posting (sale, purchase, voucher, stock change…): screens with summaries refresh on change. */
  dataVersion: number;
  /** Data restored from a .kashiro file without the server: view-only until this phone is linked to the account. */
  restoreUnlinked: boolean;
  set: (p: Partial<AppState>) => void;
  lock: () => void;
  unlock: (u: SessionUser) => void;
  touch: () => void;
}

export const useApp = create<AppState>((set) => ({
  status: 'booting',
  fatal: null,
  fatalDetail: null,
  device: null,
  business: null,
  settings: {},
  licence: null,
  user: null,
  lastActivity: Date.now(),
  inboxBump: 0,
  dataVersion: 0,
  restoreUnlinked: false,
  set: (p) => set(p),
  lock: () => set({ status: 'locked', user: null }),
  unlock: (u) => set({ status: 'ready', user: u, lastActivity: Date.now() }),
  touch: () => set({ lastActivity: Date.now() }),
}));

/** In-memory onboarding draft (never persisted: tokens stay in memory until the business is created). */
interface OnboardingDraft {
  phone: string;
  /** signup: new account by SMS · reset: forgot password (SMS, then a new password). */
  mode: 'signup' | 'reset';
  /** The account password, memory only, to set the owner's unlock on this phone. */
  password: string | null;
  auth: AuthResponse | null;
  businessForm: BusinessForm | null;
  existingBusinessId: string | null;
  /** The server's answer once the business was created / this phone attached, so a retry only redoes the local part. */
  registration: CreateBusinessResponse | null;
  set: (p: Partial<OnboardingDraft>) => void;
  reset: () => void;
}

export const useOnboarding = create<OnboardingDraft>((set) => ({
  phone: '',
  mode: 'signup',
  password: null,
  auth: null,
  businessForm: null,
  existingBusinessId: null,
  registration: null,
  set: (p) => set(p),
  reset: () => set({ phone: '', mode: 'signup', password: null, auth: null, businessForm: null, existingBusinessId: null, registration: null }),
}));

/** Call after any write that changes money/stock figures (home summary refreshes only when this moved). */
export const bumpData = () => useApp.setState((s) => ({ dataVersion: s.dataVersion + 1 }));

/**
 * Runs `fn` when the signed-in session ends: the app locks (user → null) or another user takes over. Stores that hold
 * a user's unsaved work (pending scan lists…) clear themselves with this, so nothing carries over to the next user.
 */
export function onSessionEnd(fn: () => void): () => void {
  return useApp.subscribe((s, prev) => {
    if (prev.user && s.user?.id !== prev.user.id) fn();
  });
}
