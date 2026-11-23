/**
 * Licence guard: the single place write services ask "may I write?" (PLAN.md §8.2).
 * The UI reads the same state to show banners, but enforcement lives here, not in buttons.
 */
import { computeLicenceState, verifyLicence, type LicenceState, withinLimit, type PlanLimits, type Feature } from '@daftarak/shared';
import { LICENCE_PUBLIC_KEYS } from '../../config/licenceKeys';

export class LicenceError extends Error {
  constructor(public readonly reason: LicenceState['reason'] | 'limit' | 'feature', public readonly limit?: keyof PlanLimits | Feature) {
    super(reason);
    this.name = 'LicenceError';
  }
}

/** Adding `wanted` new products would pass the plan's product limit: only `fits` more fit. */
export class ProductLimitError extends LicenceError {
  constructor(
    public readonly fits: number,
    public readonly wanted: number,
  ) {
    super('limit', 'products');
    this.name = 'ProductLimitError';
  }
}

let current: LicenceState | null = null;
const listeners = new Set<(s: LicenceState) => void>();

export function evaluateLicence(token: string | null, ctx: { now: number; deviceId: string; maxSeenTime: number }): LicenceState {
  return computeLicenceState(token ? verifyLicence(token, LICENCE_PUBLIC_KEYS) : null, ctx);
}

export function setLicenceState(s: LicenceState) {
  current = s;
  listeners.forEach((l) => l(s));
}

export function getLicenceState(): LicenceState | null {
  return current;
}

export function subscribeLicence(l: (s: LicenceState) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Throws LicenceError unless writing is allowed. Call at the start of every write service. */
export function assertCanWrite(): void {
  if (!current) throw new LicenceError('no_licence');
  if (!current.canWrite) throw new LicenceError(current.reason);
}

/** Throws LicenceError('limit') when creating one more item would exceed the plan limit. */
export function assertWithinLimit(limit: keyof PlanLimits, currentCount: number): void {
  assertCanWrite();
  if (!withinLimit(current!.limits[limit], currentCount)) throw new LicenceError('limit', limit);
}

/** Throws LicenceError('feature') when the plan lacks a feature (e.g. expenses & shifts on the free plan). */
export function assertFeature(f: Feature): void {
  assertCanWrite();
  if (!current!.features.includes(f)) throw new LicenceError('feature', f);
}

export function hasFeature(f: Feature): boolean {
  return !!current?.features.includes(f);
}
