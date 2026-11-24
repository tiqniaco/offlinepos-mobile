/**
 * «تأكيد المدير للعمليات الحساسة» in UI flows: `gate.run(action, fn)` runs `fn` straight away when no approval is
 * needed (owner, policy off), otherwise opens ApproveSheet first and passes the approval token on to `fn`, which
 * hands it to the domain service (the service checks it again — the UI is only the friendly half).
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { Permission } from '@daftarak/shared';
import { useApp } from '../../state/app';
import { needsApproval, resolvePolicy, type Approval, type SensitiveAction } from '../../domain/auth/approval';
import { ApproveSheet } from '../sales/ApproveSheet';

export function useApprovalGate() {
  const user = useApp((s) => s.user);
  const saved = useApp((s) => s.settings.managerApproval);
  const policy = useMemo(() => resolvePolicy(saved), [saved]);
  const [action, setAction] = useState<SensitiveAction | null>(null);
  const next = useRef<((a: Approval | null) => unknown) | null>(null);

  const needs = useCallback((a: SensitiveAction, opts: { amountMinor?: number; permission?: Permission } = {}) => !!user && needsApproval(policy, user, a, opts), [user, policy]);
  const run = useCallback(
    (a: SensitiveAction, fn: (approval: Approval | null) => unknown, opts: { amountMinor?: number; permission?: Permission } = {}) => {
      if (!user) return;
      if (!needsApproval(policy, user, a, opts)) return void fn(null);
      next.current = fn;
      setAction(a);
    },
    [user, policy],
  );

  const sheet = (
    <ApproveSheet
      visible={!!action}
      needs={action ?? 'void'}
      onClose={() => {
        next.current = null;
        setAction(null);
      }}
      onApproved={(_u, approval) => {
        const fn = next.current;
        next.current = null;
        setAction(null);
        void fn?.(approval ?? null);
      }}
    />
  );
  return { run, needs, sheet, policy };
}
