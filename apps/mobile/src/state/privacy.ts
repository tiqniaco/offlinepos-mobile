/**
 * «إخفاء الأرقام الحساسة»: when the personal setting `hideSensitive` is on, money on sensitive screens (home summary,
 * reports, shifts, balances) shows •••• until the eye is tapped. `revealed` lives in memory only and goes back to
 * hidden when the app locks (auto-lock too), after more than a minute in the background, and whenever the setting
 * is switched on. Selling, payment, receipts, invoices and exported/printed documents always show real numbers.
 */
import { useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { useApp } from './app';

/** Shown instead of a hidden amount. */
export const MASK = '••••';
/** Longer than this in the background → hidden again. */
export const BACKGROUND_RESET_MS = 60_000;

interface PrivacyState {
  /** Numbers shown for this session (tap on the eye). */
  revealed: boolean;
  /** When the app left the foreground (null while active). */
  backgroundedAt: number | null;
  toggle: () => void;
  hide: () => void;
}

export const usePrivacy = create<PrivacyState>((set) => ({
  revealed: false,
  backgroundedAt: null,
  toggle: () => set((s) => ({ revealed: !s.revealed })),
  hide: () => set({ revealed: false }),
}));

/** The setting (derived from the app settings; off when never set). */
export const isHideEnabled = () => !!useApp.getState().settings.hideSensitive;
/** True when sensitive figures must be masked right now. */
export const isMasked = () => isHideEnabled() && !usePrivacy.getState().revealed;

/** `text` or •••• when masked. */
export function maskMoney(text: string, masked: boolean): string {
  return masked ? MASK : text;
}

/** Every amount inside a longer text ("2 × شاي 10.00") → ••••; quantities/counts without 2 decimals stay. */
export function maskAmounts(text: string): string {
  return text.replace(/[-−]?\d[\d,]*\.\d{2}(?!\d)/g, MASK);
}

/** App foreground/background: more than a minute away hides the numbers again. */
export function noteAppState(state: AppStateStatus, now = Date.now()): void {
  const p = usePrivacy.getState();
  if (state !== 'active') {
    if (p.backgroundedAt == null) usePrivacy.setState({ backgroundedAt: now });
    return;
  }
  const away = p.backgroundedAt != null && now - p.backgroundedAt > BACKGROUND_RESET_MS;
  usePrivacy.setState(away ? { backgroundedAt: null, revealed: false } : { backgroundedAt: null });
}

// Lock / auto-lock / user switch, and the setting being switched on → hidden again.
useApp.subscribe((s, prev) => {
  const locked = prev.status === 'ready' && s.status !== 'ready';
  const userChanged = !!prev.user && s.user?.id !== prev.user.id;
  const turnedOn = !prev.settings.hideSensitive && !!s.settings.hideSensitive;
  if ((locked || userChanged || turnedOn) && usePrivacy.getState().revealed) usePrivacy.getState().hide();
});

let watching: { remove: () => void } | null = null;
/** Listen to the app going to/from the background (root layout, once). */
export function watchPrivacy(): () => void {
  if (!watching) watching = AppState.addEventListener('change', (st) => noteAppState(st));
  return () => {
    watching?.remove();
    watching = null;
  };
}

/** For a sensitive screen: `masked` (apply to every money figure on it), `enabled` (show the eye), `toggle`, `show(text)`. */
export function useSensitive(): { masked: boolean; enabled: boolean; toggle: () => void; show: (text: string) => string } {
  const enabled = useApp((s) => !!s.settings.hideSensitive);
  const revealed = usePrivacy((s) => s.revealed);
  const masked = enabled && !revealed;
  const show = useCallback((text: string) => (masked ? MASK : text), [masked]);
  return { masked, enabled, toggle: usePrivacy.getState().toggle, show };
}
