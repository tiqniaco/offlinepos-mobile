/**
 * A formatted number that counts up/down to its new value ("1,256.50 ج.م" → "1,402.00 ج.م") with a tiny
 * Reanimated scale pop. Works on any already-formatted string: the first number in it is animated, the rest
 * (currency, signs, words) stays. Off with "reduce motion"; ~28 frames at most, then a plain Text again.
 */
import { useEffect, useRef, useState } from 'react';
import type { TextProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { Text } from './Text';
import { useReduceMotion } from './reduceMotion';

const NUM = /-?\d[\d,]*(?:\.\d+)?/;

export function parseFormatted(s: string): { value: number; decimals: number; grouping: boolean; prefix: string; suffix: string } | null {
  const m = NUM.exec(s);
  if (!m) return null;
  const raw = m[0];
  const dot = raw.indexOf('.');
  return {
    value: Number(raw.replace(/,/g, '')),
    decimals: dot >= 0 ? raw.length - dot - 1 : 0,
    grouping: raw.includes(','),
    prefix: s.slice(0, m.index),
    suffix: s.slice(m.index + raw.length),
  };
}

export function formatLike(v: number, p: { decimals: number; grouping: boolean; prefix: string; suffix: string }): string {
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(p.decimals);
  const [w, f] = fixed.split('.');
  const whole = p.grouping ? w!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : w!;
  return `${p.prefix}${neg ? '-' : ''}${whole}${f ? `.${f}` : ''}${p.suffix}`;
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);

export function CountUpText({ value, duration = 450, fromZero = true, pop = true, ...rest }: TextProps & { value: string; duration?: number; fromZero?: boolean; pop?: boolean }) {
  const reduce = useReduceMotion();
  const [shown, setShown] = useState(() => {
    const p = parseFormatted(value);
    return fromZero && p && !reduce ? formatLike(0, p) : value;
  });
  const prev = useRef<number | null>(fromZero ? 0 : null);
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  useEffect(() => {
    const p = parseFormatted(value);
    const from = prev.current;
    if (p) prev.current = p.value;
    if (!p || reduce || from === null || from === p.value || typeof requestAnimationFrame !== 'function') {
      setShown(value);
      return;
    }
    if (pop) scale.value = withSequence(withTiming(1.06, { duration: 110 }), withSpring(1, { damping: 14, stiffness: 260 }));
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / duration);
      if (k >= 1) return setShown(value);
      setShown(formatLike(from + (p.value - from) * ease(k), p));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduce]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={[{ flexShrink: 1 }, anim]}>
      <Text {...rest}>{shown}</Text>
    </Animated.View>
  );
}
