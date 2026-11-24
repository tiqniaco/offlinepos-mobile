/** Auto-lock choices (minutes). IMMEDIATE = «فوراً عند الخروج»: lock as soon as the app goes to the background. */
export const IMMEDIATE = -1;
export const AUTO_LOCK_OPTIONS = [IMMEDIATE, 1, 5, 15, 30, 0] as const;

/** Lock right now because the app just left the foreground? */
export function lockOnLeave(minutes: number, state: string, held: boolean): boolean {
  return minutes === IMMEDIATE && state === 'background' && !held;
}

/**
 * Lock on coming back? (`away` ms out of the foreground; 0 = never.) The immediate mode already locked on leaving;
 * the minute modes lock after that long away, picker or not (as before).
 */
export function lockOnReturn(minutes: number, awayMs: number | null, held: boolean): boolean {
  if (awayMs == null || minutes === IMMEDIATE) return false;
  void held;
  return minutes > 0 && awayMs > minutes * 60_000;
}

/** Inactivity lock while the app is open (the immediate mode keeps the 5-minute idle lock too). */
export function idleLimitMs(minutes: number): number {
  if (minutes === IMMEDIATE) return 5 * 60_000;
  return minutes > 0 ? minutes * 60_000 : 0;
}
