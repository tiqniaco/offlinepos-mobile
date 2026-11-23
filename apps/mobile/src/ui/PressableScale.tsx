/**
 * Pressable with a native-feeling spring "press-in" (Reanimated, runs on the UI thread — no JS jank).
 * Used by buttons, cards, tiles and list rows so every tap responds the same way.
 */
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { haptic } from './haptics';

// No NativeWind interop on the animated component: on device it dropped the passed style (backgrounds, borders),
// which left chips with white-on-nothing text and tiles without cards. Callers pass plain style objects.
const APressable = Animated.createAnimatedComponent(Pressable);
const SPRING = { damping: 18, stiffness: 420, mass: 0.6 };

export function PressableScale({ style, scaleTo = 0.97, feedback, onPressIn, onPressOut, onPress, disabled, children, ...rest }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number; feedback?: 'tap' | 'select' }) {
  const s = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <APressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        s.value = withSpring(scaleTo, SPRING);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, SPRING);
        onPressOut?.(e);
      }}
      onPress={(e) => {
        if (feedback) haptic[feedback]();
        onPress?.(e);
      }}
      style={[style, anim]}
    >
      {children}
    </APressable>
  );
}
