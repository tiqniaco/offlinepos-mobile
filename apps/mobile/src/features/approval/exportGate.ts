/**
 * «تصدير البيانات / استرجاع نسخة احتياطية» behind «تأكيد المدير»: the export / restore functions check the approval
 * themselves (not only the screens), against the signed-in user, and log it in the audit chain.
 */
import { getDb } from '../../db/client';
import { withTx } from '../../db/tx';
import { useApp } from '../../state/app';
import { assertApproval, type Approval } from '../../domain/auth/approval';
import type { SessionUser } from '../../domain/auth/users';

export interface Actor {
  user: SessionUser;
  deviceId: string;
}

export const currentActor = (): Actor | null => {
  const { user, device } = useApp.getState();
  return user && device ? { user, deviceId: device.id } : null;
};

/** Throws ApprovalError / PermissionError when the shop asks for a manager and none approved. Returns the approver id. */
export async function approveDataExport(kind: 'export' | 'restore', what: string, approvedBy: Approval | null | undefined, actor: Actor | null = currentActor()): Promise<string | null> {
  // No signed-in user = first-run restore on a fresh install (nothing to protect yet).
  if (!actor) return null;
  return withTx(getDb(), (tx) => assertApproval(tx, actor, kind, { approvedBy, entity: 'backup', entityId: what }));
}
