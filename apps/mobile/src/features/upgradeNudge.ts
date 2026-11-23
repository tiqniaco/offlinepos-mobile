/**
 * Gentle, throttled upgrade suggestions: free plan → every 2 days; last 3 days of the trial → once a day.
 * Shown a few seconds after the home screen settles, never on top of another sheet.
 */
import { DEFAULT_PLANS, type LicenceState } from '@daftarak/shared';
import type { Db } from '../db/types';
import { getMeta, setMeta } from '../domain/device';
import { useUpgrade } from '../state/upgrade';

const KEY = 'upgrade.nudgeAt';
const HOUR = 3_600_000;
let scheduled = false;

export function nudgeKind(l: LicenceState | null): { reason: 'nudge' | 'trialEnd'; everyMs: number } | null {
  if (!l) return null;
  if (l.trialDaysLeft != null) return l.trialDaysLeft <= 3 ? { reason: 'trialEnd', everyMs: 20 * HOUR } : null;
  const free = l.mode === 'free' || !!DEFAULT_PLANS.find((p) => p.code === l.plan)?.isFree;
  return free ? { reason: 'nudge', everyMs: 44 * HOUR } : null;
}

export function maybeNudgeUpgrade(db: Db, l: LicenceState | null, now = Date.now()) {
  const kind = nudgeKind(l);
  if (!kind || scheduled) return;
  scheduled = true;
  void (async () => {
    try {
      const last = Number((await getMeta(db, KEY)) ?? 0);
      if (now - last < kind.everyMs) return;
      await new Promise((r) => setTimeout(r, 4000));
      if (useUpgrade.getState().reason) return;
      await setMeta(db, KEY, String(Date.now()));
      useUpgrade.getState().show(kind.reason);
    } catch {
      /* never block the home screen */
    } finally {
      scheduled = false;
    }
  })();
}
