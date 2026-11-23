/**
 * The "تم" moment: a check that pops in, a soft ring that expands and a light confetti burst (12 dots).
 * Reanimated on the UI thread (60 fps); with "reduce motion" it is a still check.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { Icon } from './Icon';
import colors from './colors';
import { useReduceMotion } from './reduceMotion';

const DOTS = 12;
const HUES = ['#3FB561', '#F5B83D', '#4C9BE8', '#E5577A', '#8E6CEF', '#2BB3A3'];

function Dot({ i, size, p }: { i: number; size: number; p: SharedValue<number> }) {
  const angle = (i / DOTS) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
  const dist = size * (0.85 + (i % 3) * 0.18);
  const d = 5 + (i % 3) * 2;
  const style = useAnimatedStyle(() => {
    const k = p.value;
    return {
      opacity: k < 0.05 ? 0 : 1 - Math.max(0, (k - 0.55) / 0.45),
      transform: [{ translateX: Math.cos(angle) * dist * k }, { translateY: Math.sin(angle) * dist * k + 18 * k * k }, { scale: 1 - 0.4 * k }],
    };
  });
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: d, height: d, borderRadius: i % 4 === 0 ? 1.5 : d / 2, backgroundColor: HUES[i % HUES.length] }, style]} />;
}

export function SuccessBurst({ size = 72, color = colors.leaf[600] }: { size?: number; color?: string }) {
  const reduce = useReduceMotion();
  const check = useSharedValue(reduce ? 1 : 0);
  const ring = useSharedValue(reduce ? 1 : 0);
  const burst = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      check.value = 1;
      return;
    }
    check.value = withSpring(1, { damping: 11, stiffness: 220, mass: 0.7 });
    ring.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) });
    burst.value = withDelay(90, withTiming(1, { duration: 900, easing: Easing.out(Easing.quad) }));
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  const checkStyle = useAnimatedStyle(() => ({ transform: [{ scale: check.value }], opacity: Math.min(1, check.value * 1.5) }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.8 + ring.value * 0.75 }], opacity: (1 - ring.value) * 0.45 }));
  return (
    <View style={{ width: size * 2, height: size * 1.6, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="image">
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, ringStyle]} />
      {reduce ? null : Array.from({ length: DOTS }, (_, i) => <Dot key={i} i={i} size={size} p={burst} />)}
      <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, checkStyle]}>
        <Icon name="check" size={size * 0.5} color="#FFFFFF" tint="transparent" />
      </Animated.View>
    </View>
  );
}
