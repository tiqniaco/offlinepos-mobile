/** Builds and signs licence tokens from D1 state (PLAN.md §8). */
import {
  DAY_MS,
  GRACE_DAYS,
  MAX_OFFLINE_DAYS,
  FREE_PLAN_CODE,
  LIMIT_KEYS,
  defaultUsageLimits,
  signLicence,
  base64urlEncode,
  ed25519Sign,
  utf8ToBytes,
  canonicalJson,
  type Feature,
  type LicencePayload,
  type PlanLimits,
} from '@daftarak/shared';
import type { Env } from '../env';

export interface PlanRow {
  code: string;
  name_ar: string;
  name_en: string;
  monthly_egp: number;
  monthly_sar: number;
  yearly_egp: number;
  yearly_sar: number;
  limits_json: string;
  features_json: string;
  is_free: number;
  trial_days: number;
  active: number;
  updated_at: number;
}

export interface BusinessRow {
  id: string;
  owner_account_id: string;
  name: string;
  country: 'EG' | 'SA';
  type: 'shop' | 'trading';
  vat_registered: number;
  plan_code: string;
  status: 'trial' | 'active' | 'past_due' | 'suspended';
  plan_expires_at: number;
  created_at: number;
  last_seen_at: number | null;
  app_version: string | null;
}

export interface DeviceRow {
  id: string;
  business_id: string;
  code: string;
  deactivated_at: number | null;
}

const TEN_YEARS = 3650 * DAY_MS;

export async function getPlan(env: Env, code: string): Promise<PlanRow> {
  const p = await env.DB.prepare(`SELECT * FROM plans WHERE code = ?1`).bind(code).first<PlanRow>();
  if (!p) throw new Error(`plan ${code} missing`);
  return p;
}

/** Every limit, server side (the usage limits are always present here). */
export type ServerLimits = Required<PlanLimits>;

/**
 * Plan limits as stored. A row saved before a limit existed reads it as 0 (e.g. ocr_month); the usage limits added
 * later (sms_day, backup_storage_mb, …) read as the seed default of that plan.
 */
export function planLimits(p: Pick<PlanRow, 'code' | 'is_free' | 'limits_json'>): ServerLimits {
  const l = JSON.parse(p.limits_json) as Partial<PlanLimits>;
  return { users: 0, products: 0, parties: 0, invoices_month: 0, backups_kept: 0, ocr_month: 0, ...defaultUsageLimits(p.code, !!p.is_free), ...l } as ServerLimits;
}

/** Per-business super-admin overrides (limit key → value). */
export async function loadOverrides(env: Env, businessId: string): Promise<Partial<Record<keyof PlanLimits, number>>> {
  const r = await env.DB.prepare(`SELECT limit_key, value FROM business_limit_overrides WHERE business_id = ?1`).bind(businessId).all<{ limit_key: string; value: number }>();
  return parseOverrides(r.results);
}

export function parseOverrides(rows: { limit_key: string; value: number }[] | Record<string, number> | null | undefined): Partial<Record<keyof PlanLimits, number>> {
  const out: Partial<Record<keyof PlanLimits, number>> = {};
  const entries = Array.isArray(rows) ? rows.map((r) => [r.limit_key, r.value] as const) : Object.entries(rows ?? {});
  for (const [k, v] of entries) if ((LIMIT_KEYS as readonly string[]).includes(k) && Number.isFinite(Number(v))) out[k as keyof PlanLimits] = Math.trunc(Number(v));
  return out;
}

/** effective limit = override ?? plan limit. */
export const withOverrides = (l: ServerLimits, o: Partial<Record<keyof PlanLimits, number>>): ServerLimits => ({ ...l, ...o });

/**
 * Pure part of effectiveLimits: the plan while it runs (trial included), paid plans keep it through grace, then the
 * free plan; suspended shops get the free plan without OCR. Overrides apply on top.
 */
export function pickLimits(
  business: Pick<BusinessRow, 'status' | 'plan_expires_at'>,
  plan: Pick<PlanRow, 'code' | 'is_free' | 'limits_json'>,
  free: Pick<PlanRow, 'code' | 'is_free' | 'limits_json'>,
  overrides: Partial<Record<keyof PlanLimits, number>>,
  now: number,
): { plan: string; limits: ServerLimits } {
  const graceUntil = business.plan_expires_at + (business.status === 'trial' ? 0 : GRACE_DAYS * DAY_MS);
  if (business.status !== 'suspended' && (plan.is_free || now <= graceUntil)) return { plan: plan.code, limits: withOverrides(planLimits(plan), overrides) };
  const base = business.status === 'suspended' ? { ...planLimits(free), ocr_month: 0 } : planLimits(free);
  return { plan: free.code, limits: business.status === 'suspended' ? { ...withOverrides(base, overrides), ocr_month: 0 } : withOverrides(base, overrides) };
}

/**
 * The limits the business may use right now — the same decision the phone makes from the licence
 * (computeLicenceState) — with the super-admin overrides applied.
 */
export async function effectiveLimits(env: Env, business: BusinessRow, now: number): Promise<{ plan: string; limits: ServerLimits }> {
  const plan = await getPlan(env, business.plan_code);
  const free = plan.code === FREE_PLAN_CODE ? plan : await getPlan(env, FREE_PLAN_CODE);
  return pickLimits(business, plan, free, await loadOverrides(env, business.id), now);
}

async function adsEnabled(env: Env): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'ads_enabled'`).first<{ value: string }>();
  return r?.value !== 'false';
}

export async function buildLicence(env: Env, business: BusinessRow, device: DeviceRow, now: number): Promise<string> {
  const plan = await getPlan(env, business.plan_code);
  const free = await getPlan(env, FREE_PLAN_CODE);
  const overrides = await loadOverrides(env, business.id);
  // The free plan never expires; it still needs the 30-day check-in (refresh_by).
  const expiresAt = plan.is_free ? now + TEN_YEARS : business.plan_expires_at;
  const payload: LicencePayload = {
    v: 1,
    kid: env.LICENCE_KID,
    tid: business.id,
    did: device.id,
    plan: plan.code,
    status: device.deactivated_at ? 'deactivated' : business.status,
    limits: withOverrides(planLimits(plan), overrides),
    features: JSON.parse(plan.features_json) as Feature[],
    fallback: { plan: free.code, limits: withOverrides(planLimits(free), overrides), features: JSON.parse(free.features_json) as Feature[] },
    iat: now,
    expires_at: expiresAt,
    grace_until: expiresAt + GRACE_DAYS * DAY_MS,
    refresh_by: now + MAX_OFFLINE_DAYS * DAY_MS,
    server_time: now,
    ads_enabled: await adsEnabled(env),
  };
  return signLicence(payload, env.LICENCE_SIGNING_KEY);
}

/** Server-signed anchor receipt: proves "the server saw this chain head at this time". */
export function signAnchorReceipt(
  env: Env,
  r: { deviceId: string; chainSeq: number; chainHead: string; auditSeq: number; auditHead: string; serverTime: number },
): string {
  const msg = utf8ToBytes(canonicalJson({ t: 'anchor', ...r }));
  return base64urlEncode(ed25519Sign(msg, env.LICENCE_SIGNING_KEY));
}
