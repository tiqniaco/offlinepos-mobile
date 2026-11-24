/**
 * Auto-lock after inactivity (default 5 min, setting) and when the app comes back from the
 * background after that long (SPEC §2). 0 = never. -1 = «فوراً عند الخروج»: locks as soon as the app goes to the
 * background (not while one of the phone's own pickers / share sheets is open: state/lockHold.ts).
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useApp } from '../state/app';
import { backgroundCheckin } from '../state/boot';
import { isLockHeld } from '../state/lockHold';
import { idleLimitMs, lockOnLeave, lockOnReturn } from './autoLockRules';

export function useAutoLock() {
  const minutes = useApp((s) => s.settings.autoLockMinutes ?? 5);
  const backgroundedAt = useRef<number | null>(null);
  /** A picker was open when the app left: the return does not lock either. */
  const leftHeld = useRef(false);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const app = useApp.getState();
      if (state !== 'active') {
        if (backgroundedAt.current == null) {
          backgroundedAt.current = Date.now();
          leftHeld.current = isLockHeld();
        }
        if (lockOnLeave(minutes, state, isLockHeld()) && app.status === 'ready') app.lock();
        return;
      }
      const away = backgroundedAt.current != null ? Date.now() - backgroundedAt.current : null;
      if (lockOnReturn(minutes, away, leftHeld.current || isLockHeld()) && app.status === 'ready') app.lock();
      backgroundedAt.current = null;
      leftHeld.current = false;
      void backgroundCheckin().catch(() => undefined);
    });
    const limit = idleLimitMs(minutes);
    const timer = setInterval(() => {
      const app = useApp.getState();
      if (limit > 0 && app.status === 'ready' && Date.now() - app.lastActivity > limit) app.lock();
    }, 15_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [minutes]);
}
