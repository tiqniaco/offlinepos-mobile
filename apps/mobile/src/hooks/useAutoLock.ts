/**
 * Auto-lock after inactivity (default 5 min, setting) and when the app comes back from the
 * background after that long (SPEC §2). 0 = never.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useApp } from '../state/app';
import { backgroundCheckin } from '../state/boot';

export function useAutoLock() {
  const minutes = useApp((s) => s.settings.autoLockMinutes ?? 5);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const app = useApp.getState();
      if (state !== 'active') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (minutes > 0 && backgroundedAt.current && Date.now() - backgroundedAt.current > minutes * 60_000 && app.status === 'ready') app.lock();
      backgroundedAt.current = null;
      void backgroundCheckin().catch(() => undefined);
    });
    const timer = setInterval(() => {
      const app = useApp.getState();
      if (minutes > 0 && app.status === 'ready' && Date.now() - app.lastActivity > minutes * 60_000) app.lock();
    }, 15_000);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [minutes]);
}
