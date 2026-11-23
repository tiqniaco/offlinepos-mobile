/** Subtle "bump" when `trigger` changes (cart line quantity +1…). UI thread; off with reduce motion. */
import { useEffect, useRef, type ReactNode } from 'react';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { useReduceMotion } from './reduceMotion';

export function Pulse({ trigger, active = true, scale = 1.025, children }: { trigger: unknown; active?: boolean; scale?: number; children: ReactNode }) {
  const reduce = useReduceMotion();
  const s = useSharedValue(1);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!active || reduce) return;
    s.value = withSequence(withTiming(scale, { duration: 90 }), withSpring(1, { damping: 12, stiffness: 300 }));
  }, [trigger]); // eslint-disable-line react-hooks/exhaustive-deps
  const style = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
