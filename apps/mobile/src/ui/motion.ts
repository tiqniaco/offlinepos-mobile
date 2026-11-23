/**
 * Native motion: every screen change uses the platform's own native-stack animation (react-native-screens),
 * mirrored for Arabic (RTL). iOS: native push with the edge swipe-back gesture (full-screen swipe).
 * Android: the iOS-style parallax slide that Android supports natively, from the reading side.
 */
import { I18nManager, Platform } from 'react-native';
import i18n from 'i18next';
import colors from './colors';

export const isRtl = () => (Platform.OS === 'web' ? i18n.language !== 'en' : I18nManager.isRTL);

export function stackOptions() {
  const rtl = isRtl();
  return {
    headerShown: false,
    contentStyle: { backgroundColor: colors.paper.DEFAULT },
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
    animationMatchesGesture: true,
    animation: (Platform.OS === 'android' ? (rtl ? 'ios_from_left' : 'ios_from_right') : 'default') as 'default',
    animationDuration: 280,
    // Screens behind the current one stop re-rendering (smoother transitions, less JS work).
    freezeOnBlur: true,
  };
}

/** Bottom-sheet style screens (scanner, quick forms). */
export const modalOptions = { presentation: 'fullScreenModal' as const, animation: 'slide_from_bottom' as const, gestureEnabled: true };
