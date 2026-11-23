/** Shared plan activation used by activation codes and manual (InstaPay / Vodafone Cash) payments. */
import { DAY_MS } from '@daftarak/shared';
import type { Env } from '../env';

export type PlanSource = 'code' | 'manual' | 'admin';

/**
 * Activates `planCode` for `days`. Extends from the current expiry when renewing the same plan that is still running;
 * otherwise starts now. Sets plan_code / status='active' / plan_expires_at / plan_source (and billing_period when given).
 * Returns the new expiry (ms).
 */
export async function activatePlan(
  env: Env,
  business: { id: string; plan_code: string; plan_expires_at: number },
  planCode: string,
  days: number,
  source: PlanSource,
  now: number,
  period?: 'monthly' | 'yearly',
): Promise<number> {
  const from = business.plan_code === planCode && business.plan_expires_at > now ? business.plan_expires_at : now;
  const until = from + days * DAY_MS;
  if (period) {
    await env.DB.prepare(`UPDATE businesses SET plan_code = ?2, status = 'active', plan_expires_at = ?3, plan_source = ?4, billing_period = ?5 WHERE id = ?1`)
      .bind(business.id, planCode, until, source, period)
      .run();
  } else {
    await env.DB.prepare(`UPDATE businesses SET plan_code = ?2, status = 'active', plan_expires_at = ?3, plan_source = ?4 WHERE id = ?1`).bind(business.id, planCode, until, source).run();
  }
  return until;
}
