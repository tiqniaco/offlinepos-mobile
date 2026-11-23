/** Shared plan activation used by activation codes and manual (InstaPay / Vodafone Cash) payments. */
import { DAY_MS } from '@daftarak/shared';
import type { Env } from '../env';
import { ApiError } from '../lib/http';

export type PlanSource = 'code' | 'manual' | 'admin';

export interface ActivationBusiness {
  id: string;
  plan_code: string;
  plan_expires_at: number;
  status?: string;
  country?: string;
}

interface PriceRow {
  code: string;
  monthly_egp: number;
  monthly_sar: number;
  is_free: number;
}

/**
 * New expiry for activating `planCode` for `days`:
 *  - same plan still running → extends from the current expiry;
 *  - a different PAID plan still running (not a trial) → starts now, plus the unused value of the current plan
 *    converted to days of the new one (pro-rata by monthly price): upgrading never loses paid days;
 *  - otherwise (trial, free, expired) → starts now.
 */
export function computeActivation(
  business: ActivationBusiness,
  current: PriceRow | null,
  next: PriceRow | null,
  planCode: string,
  days: number,
  now: number,
): { until: number; creditDays: number } {
  const running = business.plan_expires_at > now;
  if (business.plan_code === planCode && running) return { until: business.plan_expires_at + days * DAY_MS, creditDays: 0 };
  let creditMs = 0;
  if (running && business.status !== 'trial' && current && !current.is_free && next && !next.is_free) {
    const sar = business.country === 'SA';
    const cur = sar ? current.monthly_sar : current.monthly_egp;
    const nxt = sar ? next.monthly_sar : next.monthly_egp;
    if (cur > 0 && nxt > 0) creditMs = Math.floor(((business.plan_expires_at - now) * cur) / nxt);
  }
  return { until: now + days * DAY_MS + creditMs, creditDays: Math.round((creditMs / DAY_MS) * 10) / 10 };
}

/** Loads the two plans' prices and computes the activation (see computeActivation). */
export async function planActivation(env: Env, business: ActivationBusiness, planCode: string, days: number, now: number) {
  const r = await env.DB.prepare(`SELECT code, monthly_egp, monthly_sar, is_free FROM plans WHERE code IN (?1, ?2)`).bind(business.plan_code, planCode).all<PriceRow>();
  const find = (c: string) => r.results.find((p) => p.code === c) ?? null;
  return computeActivation(business, find(business.plan_code), find(planCode), planCode, days, now);
}

/**
 * The UPDATE that applies an activation. A suspended business stays suspended (an admin lifts it explicitly);
 * its status before suspension becomes 'active' so unsuspending restores the paid plan.
 * The activation is also recorded as the MANUAL entitlement (manual_plan_code / manual_until): a later store purchase
 * may cover it for a while, but its expiry or refund falls back to it (routes/phase6.ts).
 * `guard` = extra SQL condition (e.g. "the plan is still what was read") for atomic batches; its args start at ?6.
 */
export function activationStatement(env: Env, businessId: string, planCode: string, until: number, source: PlanSource, period?: 'monthly' | 'yearly', guard?: { sql: string; args: unknown[] }) {
  const base = `UPDATE businesses SET plan_code = ?2, plan_expires_at = ?3, plan_source = ?4, billing_period = COALESCE(?5, billing_period),
      manual_plan_code = ?2, manual_until = ?3,
      status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'active' END,
      status_before_suspend = CASE WHEN status = 'suspended' THEN 'active' ELSE status_before_suspend END
    WHERE id = ?1`;
  if (!guard) return env.DB.prepare(base).bind(businessId, planCode, until, source, period ?? null);
  return env.DB.prepare(`${base} AND ${guard.sql}`).bind(businessId, planCode, until, source, period ?? null, ...guard.args);
}

/** SQL guard (args at ?6, ?7): the business still has the plan / expiry the activation was computed from. */
export const unchangedPlanGuard = (b: Pick<ActivationBusiness, 'plan_code' | 'plan_expires_at'>) => ({ sql: `plan_code = ?6 AND plan_expires_at = ?7`, args: [b.plan_code, b.plan_expires_at] });

/**
 * Activates `planCode` for `days` (see computeActivation for the start date). Sets plan_code / status='active'
 * (a suspension is kept) / plan_expires_at / plan_source (and billing_period when given). Returns the new expiry (ms).
 * Optimistic: the UPDATE only applies while the plan is still what was read; a concurrent activation makes it re-read
 * and recompute (never losing either one's days), and after a few lost races it gives up with 409 concurrent_update.
 */
export async function activatePlan(
  env: Env,
  business: ActivationBusiness,
  planCode: string,
  days: number,
  source: PlanSource,
  now: number,
  period?: 'monthly' | 'yearly',
): Promise<number> {
  let cur: ActivationBusiness = business;
  for (let i = 0; i < 5; i++) {
    const { until } = await planActivation(env, cur, planCode, days, now);
    const res = await activationStatement(env, cur.id, planCode, until, source, period, unchangedPlanGuard(cur)).run();
    if (res.meta.changes === 1) return until;
    const fresh = await env.DB.prepare(`SELECT id, plan_code, plan_expires_at, status, country FROM businesses WHERE id = ?1`).bind(cur.id).first<ActivationBusiness>();
    if (!fresh) break;
    cur = fresh;
  }
  throw new ApiError(409, 'concurrent_update', 'the plan changed meanwhile, try again');
}

/** Store plan ranking (higher = more features). Unknown paid plans rank as basic. */
export const planRank = (code: string | null | undefined) => (code === 'pro' ? 2 : code && code !== 'free' && code !== 'trial' ? 1 : 0);

/**
 * When the store plan ends: back to the manual entitlement (activation code / manual payment / admin) while it still
 * runs; otherwise an expiry ends the store plan at the store's date and a refund drops to the free plan now.
 * Applies only while the business is on the store plan.
 */
export function storeEndStatement(env: Env, businessId: string, kind: 'expire' | 'refund', now: number, storeUntil: number, freePlan: string) {
  const manual = `(manual_until > ?2 AND manual_plan_code IS NOT NULL)`;
  return env.DB.prepare(
    `UPDATE businesses SET
       plan_code = CASE WHEN ${manual} THEN manual_plan_code WHEN ?5 = 'refund' THEN ?4 ELSE plan_code END,
       plan_expires_at = CASE WHEN ${manual} THEN manual_until WHEN ?5 = 'refund' THEN ?2 ELSE MIN(plan_expires_at, ?3) END,
       plan_source = CASE WHEN ${manual} THEN 'manual' ELSE plan_source END,
       billing_period = CASE WHEN ${manual} OR ?5 = 'refund' THEN NULL ELSE billing_period END,
       status = CASE WHEN status = 'suspended' THEN 'suspended' WHEN ${manual} OR ?5 = 'refund' THEN 'active' ELSE status END
     WHERE id = ?1 AND plan_source = 'store'`,
  ).bind(businessId, now, storeUntil, freePlan, kind);
}
