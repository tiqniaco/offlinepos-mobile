/** Builds and signs licence tokens from D1 state (PLAN.md §8). */
import {
  DAY_MS,
  GRACE_DAYS,
  MAX_OFFLINE_DAYS,
  FREE_PLAN_CODE,
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

async function adsEnabled(env: Env): Promise<boolean> {
  const r = await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'ads_enabled'`).first<{ value: string }>();
  return r?.value !== 'false';
}

export async function buildLicence(env: Env, business: BusinessRow, device: DeviceRow, now: number): Promise<string> {
  const plan = await getPlan(env, business.plan_code);
  const free = await getPlan(env, FREE_PLAN_CODE);
  // The free plan never expires; it still needs the 30-day check-in (refresh_by).
  const expiresAt = plan.is_free ? now + TEN_YEARS : business.plan_expires_at;
  const payload: LicencePayload = {
    v: 1,
    kid: env.LICENCE_KID,
    tid: business.id,
    did: device.id,
    plan: plan.code,
    status: device.deactivated_at ? 'deactivated' : business.status,
    limits: JSON.parse(plan.limits_json) as PlanLimits,
    features: JSON.parse(plan.features_json) as Feature[],
    fallback: { plan: free.code, limits: JSON.parse(free.limits_json) as PlanLimits, features: JSON.parse(free.features_json) as Feature[] },
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
