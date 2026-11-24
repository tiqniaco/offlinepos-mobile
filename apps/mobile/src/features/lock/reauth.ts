/**
 * Owner re-authentication for the security screens («القفل والأمان», «المستخدمين والصلاحيات»): a successful check
 * is valid for 2 minutes in this session (memory only) and is forgotten when the app locks.
 */
import { useApp } from '../../state/app';

export const REAUTH_MS = 2 * 60_000;
let okUntil = 0;

export const reauthFresh = (now = Date.now()) => now < okUntil;
export const markReauth = (now = Date.now()) => {
  okUntil = now + REAUTH_MS;
};
export const clearReauth = () => {
  okUntil = 0;
};

// Lock / user switch → ask again next time.
useApp.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id || (s.status !== 'ready' && prev.status === 'ready')) clearReauth();
});
