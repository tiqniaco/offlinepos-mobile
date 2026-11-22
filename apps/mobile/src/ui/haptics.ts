/** Small, consistent haptic vocabulary (no-op on web). Feels native without being noisy. */
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

const on = Platform.OS !== 'web';
export const haptic = {
  /** Chips, segmented controls, toggles. */
  select: () => on && void Haptics.selectionAsync().catch(() => undefined),
  /** Buttons that change something, item added to the cart. */
  tap: () => on && void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined),
  /** Sale posted, saved, shift closed. */
  success: () => on && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  warn: () => on && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
  error: () => on && void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined),
};
