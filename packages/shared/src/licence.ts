/**
 * Licence token: issue (server) and verify + mode computation (phone, offline).
 * Format: "lic1.<base64url(payload JSON)>.<base64url(Ed25519 signature over 'lic1.<payload>')>"
 * See PLAN.md §8 and D-12 / D-20.
 */
import { z } from 'zod';
import { base64urlDecode, base64urlEncode, ed25519Sign, ed25519Verify, utf8Decode, utf8ToBytes } from './crypto';
import { FEATURES, type Feature, type PlanLimits } from './plans';

export const DAY_MS = 86_400_000;
export const GRACE_DAYS = 7;
/** Owner decision Q-03: a device must check in at least once every 30 days. */
export const MAX_OFFLINE_DAYS = 30;
/** Clock rollback tolerance (SPEC §6). */
export const CLOCK_TOLERANCE_MS = DAY_MS;

const limitsSchema = z.object({
  users: z.number().int(),
  products: z.number().int(),
  parties: z.number().int(),
  invoices_month: z.number().int(),
  backups_kept: z.number().int(),
});

const featureSchema = z.enum(FEATURES);

export const licencePayloadSchema = z.object({
  v: z.literal(1),
  kid: z.string().min(1),
  tid: z.string().min(1), // business (tenant) id
  did: z.string().min(1), // device id this token is bound to
  plan: z.string().min(1),
  status: z.enum(['trial', 'active', 'past_due', 'suspended', 'deactivated']),
  limits: limitsSchema,
  features: z.array(featureSchema),
  /** What the business falls back to when the plan ends (the free plan, D-20). */
  fallback: z.object({ plan: z.string(), limits: limitsSchema, features: z.array(featureSchema) }),
  iat: z.number().int(),
  expires_at: z.number().int(),
  grace_until: z.number().int(),
  refresh_by: z.number().int(),
  server_time: z.number().int(),
  /** Remote switch: when false, no ads are shown even on the free plan (PLAN.md §18). */
  ads_enabled: z.boolean(),
});
export type LicencePayload = z.infer<typeof licencePayloadSchema>;

const PREFIX = 'lic1';

export function signLicence(payload: LicencePayload, secretKeyHex: string): string {
  const parsed = licencePayloadSchema.parse(payload);
  const body = base64urlEncode(utf8ToBytes(JSON.stringify(parsed)));
  const signingInput = `${PREFIX}.${body}`;
  const sig = ed25519Sign(utf8ToBytes(signingInput), secretKeyHex);
  return `${signingInput}.${base64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: LicencePayload }
  | { ok: false; reason: 'format' | 'unknown_key' | 'signature' | 'schema' };

/** Verify a token offline with the embedded public keys (map kid → hex public key). */
export function verifyLicence(token: string, publicKeys: Record<string, string>): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return { ok: false, reason: 'format' };
  let json: unknown;
  let sig: Uint8Array;
  try {
    json = JSON.parse(utf8Decode(base64urlDecode(parts[1]!)));
    sig = base64urlDecode(parts[2]!);
  } catch {
    return { ok: false, reason: 'format' };
  }
  const parsed = licencePayloadSchema.safeParse(json);
  if (!parsed.success) return { ok: false, reason: 'schema' };
  const pub = publicKeys[parsed.data.kid];
  if (!pub) return { ok: false, reason: 'unknown_key' };
  if (!ed25519Verify(sig, utf8ToBytes(`${PREFIX}.${parts[1]}`), pub)) return { ok: false, reason: 'signature' };
  return { ok: true, payload: parsed.data };
}

export type LicenceMode = 'full' | 'grace' | 'free' | 'read_only' | 'needs_checkin';

export interface LicenceState {
  mode: LicenceMode;
  reason:
    | 'ok'
    | 'trial'
    | 'grace'
    | 'plan_ended'
    | 'no_licence'
    | 'invalid'
    | 'wrong_device'
    | 'deactivated'
    | 'suspended'
    | 'offline_too_long'
    | 'clock_rollback';
  plan: string;
  limits: PlanLimits;
  features: Feature[];
  /** Can the user create/post documents and edit data? */
  canWrite: boolean;
  showAds: boolean;
  trialDaysLeft: number | null;
  graceDaysLeft: number | null;
}

const READ_ONLY_LIMITS: PlanLimits = { users: 0, products: 0, parties: 0, invoices_month: 0, backups_kept: 0 };

export interface LicenceContext {
  now: number;
  deviceId: string;
  /** Highest trusted time ever seen on this device (PLAN.md §8.3). */
  maxSeenTime: number;
}

/**
 * Pure function: decide what the app may do right now. Called at start, on foreground and by every
 * write service through the licence guard. Never deletes or hides data — only restricts writing.
 */
export function computeLicenceState(verify: VerifyResult | null, ctx: LicenceContext): LicenceState {
  const ro = (reason: LicenceState['reason'], p?: LicencePayload): LicenceState => ({
    mode: 'read_only',
    reason,
    plan: p?.plan ?? 'none',
    limits: p?.limits ?? READ_ONLY_LIMITS,
    features: p?.features ?? [],
    canWrite: false,
    showAds: false,
    trialDaysLeft: null,
    graceDaysLeft: null,
  });
  if (!verify) return ro('no_licence');
  if (!verify.ok) return ro('invalid');
  const p = verify.payload;
  if (p.did !== ctx.deviceId) return ro('wrong_device', p);
  if (p.status === 'deactivated') return ro('deactivated', p);
  if (p.status === 'suspended') return ro('suspended', p);

  // Clock rollback: device time went back more than 24h vs. anything trusted we have seen.
  const trusted = Math.max(ctx.maxSeenTime, p.server_time);
  if (ctx.now < trusted - CLOCK_TOLERANCE_MS) {
    return { ...ro('clock_rollback', p), mode: 'needs_checkin' };
  }
  if (ctx.now > p.refresh_by) return ro('offline_too_long', p);

  const daysLeft = (until: number) => Math.max(0, Math.ceil((until - ctx.now) / DAY_MS));
  const adsFor = (features: Feature[]) => p.ads_enabled && !features.includes('no_ads');

  if (ctx.now <= p.expires_at) {
    return {
      mode: 'full',
      reason: p.status === 'trial' ? 'trial' : 'ok',
      plan: p.plan,
      limits: p.limits,
      features: p.features,
      canWrite: true,
      showAds: adsFor(p.features),
      trialDaysLeft: p.status === 'trial' ? daysLeft(p.expires_at) : null,
      graceDaysLeft: null,
    };
  }
  // A trial has no grace: it falls straight to the free plan. Paid plans get 7 days of grace.
  if (p.status !== 'trial' && ctx.now <= p.grace_until) {
    return {
      mode: 'grace',
      reason: 'grace',
      plan: p.plan,
      limits: p.limits,
      features: p.features,
      canWrite: true,
      showAds: adsFor(p.features),
      trialDaysLeft: null,
      graceDaysLeft: daysLeft(p.grace_until),
    };
  }
  return {
    mode: 'free',
    reason: 'plan_ended',
    plan: p.fallback.plan,
    limits: p.fallback.limits,
    features: p.fallback.features,
    canWrite: true,
    showAds: adsFor(p.fallback.features),
    trialDaysLeft: null,
    graceDaysLeft: null,
  };
}

/** New max-seen time after observing `now` (never goes backwards). */
export function bumpMaxSeen(maxSeen: number, now: number, serverTime?: number): number {
  return Math.max(maxSeen, serverTime ?? 0, now);
}
