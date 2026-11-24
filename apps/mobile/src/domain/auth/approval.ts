/**
 * «تأكيد المدير للعمليات الحساسة». Shop-wide policy (settings key `managerApproval`, changed with settings.manage):
 * when an action is switched on, anyone who is not the owner needs a manager / owner to type their PIN first; a user
 * who lacks the action's own permission (a cashier voiding an invoice) always needs it, whatever the policy says.
 *
 * The PIN step happens in the UI (ApproveSheet) through `approveWithPin`, which checks the PIN with the normal
 * lock-out rules and hands back a short-lived, single-use approval token. Domain services never trust a user object
 * from the caller: they get `{ userId, token }`, redeem the token here (`assertApproval`) and write the approval to
 * the audit log in the same transaction as the change.
 */
import { eq } from 'drizzle-orm';
import { roleHas, uuidv7, type Permission } from '@daftarak/shared';
import type { Db } from '../../db/types';
import { settings } from '../../db/schema';
import { appendAudit, type AuditAction } from '../audit/audit';
import { PermissionError, unlockWithPin, type SessionUser } from './users';

export type SensitiveAction = 'void' | 'return' | 'productDelete' | 'priceChange' | 'export' | 'restore';

export interface ApprovalPolicy {
  /** Void a sale / purchase / voucher. */
  void: boolean;
  /** Sales return above `returnOverMinor`. */
  returnOver: boolean;
  returnOverMinor: number;
  productDelete: boolean;
  /** Product form price edits and bulk price changes. */
  priceChange: boolean;
  /** Excel export, portable backup export and restore-from-file on an existing shop. */
  exportData: boolean;
}

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = { void: true, returnOver: true, returnOverMinor: 50_000, productDelete: true, priceChange: false, exportData: true };

/** Saved policy on top of the defaults (missing fields / never saved → defaults). */
export function resolvePolicy(saved: Partial<ApprovalPolicy> | null | undefined): ApprovalPolicy {
  const out = { ...DEFAULT_APPROVAL_POLICY };
  for (const [k, v] of Object.entries(saved ?? {})) if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v;
  if (!Number.isSafeInteger(out.returnOverMinor) || out.returnOverMinor < 0) out.returnOverMinor = DEFAULT_APPROVAL_POLICY.returnOverMinor;
  return out;
}

export async function loadPolicy(db: Pick<Db, 'select'>): Promise<ApprovalPolicy> {
  const row = (await db.select().from(settings).where(eq(settings.key, 'managerApproval')).limit(1))[0];
  return resolvePolicy(row ? (JSON.parse(row.valueJson) as Partial<ApprovalPolicy>) : null);
}

export const isOwner = (u: Pick<SessionUser, 'roleKey'>) => u.roleKey === 'owner';

/** What the approver must be allowed to do himself. */
const APPROVER_NEEDS: Record<SensitiveAction, Permission> = {
  void: 'doc.void',
  return: 'doc.void',
  productDelete: 'products.manage',
  priceChange: 'price.change',
  export: 'settings.manage',
  restore: 'settings.manage',
};

export const AUDIT_ACTION: Record<SensitiveAction, AuditAction> = {
  void: 'approval.void',
  return: 'approval.return',
  productDelete: 'approval.product_delete',
  priceChange: 'approval.price_change',
  export: 'approval.export',
  restore: 'approval.restore',
};

/** Does the policy alone ask for a manager here? The owner is never asked. */
export function policyNeeds(policy: ApprovalPolicy, user: Pick<SessionUser, 'roleKey'>, action: SensitiveAction, amountMinor = 0): boolean {
  if (isOwner(user)) return false;
  switch (action) {
    case 'void':
      return policy.void;
    case 'return':
      return policy.returnOver && amountMinor > policy.returnOverMinor;
    case 'productDelete':
      return policy.productDelete;
    case 'priceChange':
      return policy.priceChange;
    case 'export':
    case 'restore':
      return policy.exportData;
  }
}

/** UI pre-check: show ApproveSheet before calling the service? (`permission` = the action's own right, if any.) */
export function needsApproval(policy: ApprovalPolicy, user: SessionUser, action: SensitiveAction, opts: { amountMinor?: number; permission?: Permission } = {}): boolean {
  if (opts.permission && !roleHas(user.permissions, opts.permission)) return true;
  return policyNeeds(policy, user, action, opts.amountMinor);
}

export class ApprovalError extends Error {
  constructor(public readonly code: 'approval_required' | 'approval_invalid' | 'no_right', public readonly action: SensitiveAction) {
    super(`${code}:${action}`);
  }
}

export interface Approval {
  userId: string;
  token: string;
}

/** Tokens live in memory only, for 2 minutes (wall clock), and are used once. */
export const APPROVAL_TTL_MS = 2 * 60_000;
const tokens = new Map<string, { approver: SessionUser; action: SensitiveAction; exp: number }>();

function issue(approver: SessionUser, action: SensitiveAction, now: number): Approval {
  for (const [k, v] of tokens) if (v.exp <= now) tokens.delete(k);
  const token = uuidv7(now) + Math.random().toString(36).slice(2);
  tokens.set(token, { approver, action, exp: now + APPROVAL_TTL_MS });
  return { userId: approver.id, token };
}

/** Can this user approve `action`? Managers / owner (never a cashier) who hold the action's right. */
export function canApprove(u: SessionUser, action: SensitiveAction): boolean {
  return u.roleKey !== 'cashier' && roleHas(u.permissions, APPROVER_NEEDS[action]);
}

/** The approver types their PIN (lock-out rules apply). Throws PinError / ApprovalError('no_right'). */
export async function approveWithPin(db: Db, approverId: string, pin: string, action: SensitiveAction, now = Date.now()): Promise<{ user: SessionUser; approval: Approval }> {
  const user = await unlockWithPin(db, approverId, pin, now);
  if (!canApprove(user, action)) throw new ApprovalError('no_right', action);
  return { user, approval: issue(user, action, Date.now()) };
}

/**
 * Inside the service's transaction: is an approval needed, and is the one given valid? Writes `approval.*` to the
 * audit log (by the approver, for the user). Returns the approver's id, or null when no approval was needed.
 * Without an approval, a missing own permission still throws PermissionError (as before).
 */
export async function assertApproval(
  tx: Pick<Db, 'select' | 'insert'>,
  ctx: { user: SessionUser; deviceId: string; at?: number },
  action: SensitiveAction,
  opts: { approvedBy?: Approval | null; amountMinor?: number; permission?: Permission; entity: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<string | null> {
  const lacks = !!opts.permission && !roleHas(ctx.user.permissions, opts.permission);
  const policy = await loadPolicy(tx);
  if (!lacks && !policyNeeds(policy, ctx.user, action, opts.amountMinor)) return null;
  if (!opts.approvedBy) {
    if (lacks) throw new PermissionError(opts.permission!);
    throw new ApprovalError('approval_required', action);
  }
  const at = ctx.at ?? Date.now();
  const entry = tokens.get(opts.approvedBy.token);
  tokens.delete(opts.approvedBy.token);
  if (!entry || entry.exp <= Date.now() || entry.action !== action || entry.approver.id !== opts.approvedBy.userId) throw new ApprovalError('approval_invalid', action);
  // Someone else approves: a manager cannot confirm their own sensitive action.
  if (entry.approver.id === ctx.user.id || !canApprove(entry.approver, action) || (lacks && !roleHas(entry.approver.permissions, opts.permission!))) throw new ApprovalError('no_right', action);
  await appendAudit(tx, {
    action: AUDIT_ACTION[action],
    entity: opts.entity,
    entityId: opts.entityId ?? null,
    after: { for: ctx.user.id, ...(opts.amountMinor != null ? { amount: opts.amountMinor } : {}), ...(opts.details ?? {}) },
    userId: entry.approver.id,
    deviceId: ctx.deviceId,
    at,
  });
  return entry.approver.id;
}

/** Tests only: what the PIN step would hand back (no PIN check). */
export function __issueForTest(approver: SessionUser, action: SensitiveAction, now = Date.now()): Approval {
  return issue(approver, action, now);
}
