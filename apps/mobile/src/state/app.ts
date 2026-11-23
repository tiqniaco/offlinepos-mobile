/**
 * UI state only (Zustand). The database stays the source of truth; this mirrors what screens need.
 */
import { create } from 'zustand';
import type { AuthResponse, LicenceState } from '@daftarak/shared';
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
  fatal: 'db_not_encrypted' | 'db_open_failed' | null;
  device: { id: string; code: string } | null;
  business: BusinessInfo | null;
  settings: Partial<AppSettings>;
  licence: LicenceState | null;
  user: SessionUser | null;
  lastActivity: number;
  /** Changes when new messages from Daftarak arrive (home bell refreshes). */
  inboxBump: number;
  set: (p: Partial<AppState>) => void;
  lock: () => void;
  unlock: (u: SessionUser) => void;
  touch: () => void;
}

export const useApp = create<AppState>((set) => ({
  status: 'booting',
  fatal: null,
  device: null,
  business: null,
  settings: {},
  licence: null,
  user: null,
  lastActivity: Date.now(),
  inboxBump: 0,
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
  set: (p) => set(p),
  reset: () => set({ phone: '', mode: 'signup', password: null, auth: null, businessForm: null, existingBusinessId: null }),
}));
