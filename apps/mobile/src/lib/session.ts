/**
 * Short-lived access token for the few online actions (backup now, restore, activation code, sessions).
 * Obtained by rotating the refresh token; kept in memory only.
 */
import { api } from '../api/client';
import { getSecret, setSecret, SECURE_KEYS } from './secure';

let cached: { token: string; until: number } | null = null;
let chain: Promise<unknown> = Promise.resolve();

/**
 * Every refresh-token rotation (check-in, access token) goes through this lock: the server revokes the whole
 * session if an old refresh token is ever reused, so two rotations must never overlap.
 */
export function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => undefined);
  return p;
}

export async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  return withRefreshLock(rotateForAccess);
}

async function rotateForAccess(): Promise<string> {
  if (cached && cached.until > Date.now() + 30_000) return cached.token;
  const refresh = await getSecret(SECURE_KEYS.refreshToken);
  if (!refresh) throw new Error('signed_out');
  const r = await api.refresh(refresh);
  await setSecret(SECURE_KEYS.refreshToken, r.refreshToken);
  cached = { token: r.accessToken, until: r.accessExpiresAt };
  return r.accessToken;
}

/** For flows that start from a fresh login (restore on a new phone). */
export function useAccessToken(token: string, until: number) {
  cached = { token, until };
}

export function clearAccessToken() {
  cached = null;
}
