/** Small, consistent haptic vocabulary (no-op on web). Feels native without being noisy. Off in المظهر → الاهتزاز. */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const native = Platform.OS !== 'web';
let enabled = true;
export function setHapticsEnabled(v: boolean) {
  enabled = v;
}
export const hapticsEnabled = () => enabled;

const run = (f: () => Promise<void>) => {
  if (!native || !enabled) return false;
  try {
    void f().catch(() => undefined);
  } catch {
    /* module unavailable */
  }
  return true;
};

export const haptic = {
  /** Chips, segmented controls, toggles. */
  select: () => run(() => Haptics.selectionAsync()),
  /** Buttons that change something, item added to the cart. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A firmer bump: line removed, quantity −1. */
  soft: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft ?? Haptics.ImpactFeedbackStyle.Light)),
  /** Barcode read: crisp medium bump. */
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** Sale posted, saved, shift closed. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
