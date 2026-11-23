/** Shared plan activation used by activation codes and manual (InstaPay / Vodafone Cash) payments. */
import { DAY_MS } from '@daftarak/shared';
import type { Env } from '../env';

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
 * `guard` = extra SQL condition (e.g. "the payment request was approved by this call") for atomic batches.
 */
export function activationStatement(env: Env, businessId: string, planCode: string, until: number, source: PlanSource, period?: 'monthly' | 'yearly', guard?: { sql: string; args: unknown[] }) {
  const base = `UPDATE businesses SET plan_code = ?2, plan_expires_at = ?3, plan_source = ?4, billing_period = COALESCE(?5, billing_period),
      status = CASE WHEN status = 'suspended' THEN 'suspended' ELSE 'active' END,
      status_before_suspend = CASE WHEN status = 'suspended' THEN 'active' ELSE status_before_suspend END
    WHERE id = ?1`;
  if (!guard) return env.DB.prepare(base).bind(businessId, planCode, until, source, period ?? null);
  return env.DB.prepare(`${base} AND ${guard.sql}`).bind(businessId, planCode, until, source, period ?? null, ...guard.args);
}

/**
 * Activates `planCode` for `days` (see computeActivation for the start date). Sets plan_code / status='active'
 * (a suspension is kept) / plan_expires_at / plan_source (and billing_period when given). Returns the new expiry (ms).
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
  const { until } = await planActivation(env, business, planCode, days, now);
  await activationStatement(env, business.id, planCode, until, source, period).run();
  return until;
}
