/**
 * The phone's own pickers / share sheets (Files, gallery, camera, WhatsApp share, print dialog) send the app to the
 * background on Android. While one is open, «فوراً عند الخروج» must not lock (the screen would lose what the user
 * was doing) and the app-switcher cover is not needed for 'inactive'. Wrap such calls in `withLockHold`.
 */
let holds = 0;
let releasedAt = 0;

/** Grace after the picker closed: the 'active' event can arrive just after the promise resolves. */
const GRACE_MS = 1500;

export const isLockHeld = (now = Date.now()) => holds > 0 || now - releasedAt < GRACE_MS;

export async function withLockHold<T>(fn: () => Promise<T>): Promise<T> {
  holds++;
  try {
    return await fn();
  } finally {
    holds = Math.max(0, holds - 1);
    releasedAt = Date.now();
  }
}
