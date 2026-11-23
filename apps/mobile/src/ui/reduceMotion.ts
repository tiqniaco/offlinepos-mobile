/** "Reduce motion" (accessibility setting): decorative animations (count-up, bursts, pulses) turn off. */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let reduced = false;
let started = false;
const listeners = new Set<(v: boolean) => void>();

function start() {
  if (started) return;
  started = true;
  try {
    void AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        reduced = !!v;
        listeners.forEach((l) => l(reduced));
      })
      .catch(() => undefined);
    AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => {
      reduced = !!v;
      listeners.forEach((l) => l(reduced));
    });
  } catch {
    /* not available (tests/web) */
  }
}

export function reduceMotion(): boolean {
  start();
  return reduced;
}

export function useReduceMotion(): boolean {
  start();
  const [v, setV] = useState(reduced);
  useEffect(() => {
    listeners.add(setV);
    setV(reduced);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}
