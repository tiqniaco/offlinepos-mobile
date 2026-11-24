import ar from '../../i18n/ar.json';
import { AUTO_LOCK_OPTIONS, IMMEDIATE, idleLimitMs, lockOnLeave, lockOnReturn } from '../../hooks/autoLockRules';
import { coverEnabled, shouldCover } from './coverRules';
import { isLockHeld, withLockHold } from '../../state/lockHold';
import { clearReauth, markReauth, reauthFresh, REAUTH_MS } from '../lock/reauth';
import { AUDIT_ACTION } from '../../domain/auth/approval';
import { safeUrl } from '../../domain/inbox/inbox';
import { useApp } from '../../state/app';

describe('auto-lock «فوراً عند الخروج»', () => {
  it('is offered first; locks on background, not on inactive or while a picker is open', () => {
    expect(AUTO_LOCK_OPTIONS[0]).toBe(IMMEDIATE);
    expect(lockOnLeave(IMMEDIATE, 'background', false)).toBe(true);
    expect(lockOnLeave(IMMEDIATE, 'inactive', false)).toBe(false);
    expect(lockOnLeave(IMMEDIATE, 'background', true)).toBe(false);
    expect(lockOnLeave(5, 'background', false)).toBe(false);
  });
  it('minute modes unchanged: lock on return after that long; 0 = never', () => {
    expect(lockOnReturn(5, 6 * 60_000, false)).toBe(true);
    expect(lockOnReturn(5, 4 * 60_000, false)).toBe(false);
    expect(lockOnReturn(0, 10 * 3_600_000, false)).toBe(false);
    expect(lockOnReturn(IMMEDIATE, 10_000, true)).toBe(false);
    expect(idleLimitMs(IMMEDIATE)).toBe(5 * 60_000);
    expect(idleLimitMs(0)).toBe(0);
  });
  it('lock hold covers the picker and a short grace after it', async () => {
    let inside = false;
    await withLockHold(async () => {
      inside = isLockHeld();
    });
    expect(inside).toBe(true);
    expect(isLockHeld(Date.now() + 5_000)).toBe(false);
  });
});

describe('app switcher cover', () => {
  it('default on; covers inactive/background, not active; not for inactive while a picker is open', () => {
    expect(coverEnabled(undefined)).toBe(true);
    expect(coverEnabled(false)).toBe(false);
    expect(shouldCover(true, 'active', false)).toBe(false);
    expect(shouldCover(true, 'inactive', false)).toBe(true);
    expect(shouldCover(true, 'background', false)).toBe(true);
    expect(shouldCover(true, 'inactive', true)).toBe(false);
    expect(shouldCover(true, 'background', true)).toBe(true);
    expect(shouldCover(false, 'background', false)).toBe(false);
  });
});

describe('owner re-auth for the security screens', () => {
  it('valid for 2 minutes; forgotten when the app locks', () => {
    clearReauth();
    expect(reauthFresh()).toBe(false);
    const now = Date.now();
    markReauth(now);
    expect(reauthFresh(now + REAUTH_MS - 1)).toBe(true);
    expect(reauthFresh(now + REAUTH_MS + 1)).toBe(false);
    markReauth();
    useApp.setState({ status: 'ready' });
    useApp.getState().lock();
    expect(reauthFresh()).toBe(false);
  });
});

describe('labels and links', () => {
  it('every approval audit action has an Arabic label', () => {
    const labels = ar.audit.actions as Record<string, string>;
    for (const a of Object.values(AUDIT_ACTION)) expect(labels[a.replace('.', '_')]).toBeTruthy();
  });
  it('the new-device alert link opens «الأجهزة المسجّل عليها»', () => {
    expect(safeUrl('/settings/sessions')).toBe('/settings/sessions');
    expect(safeUrl('/settings/sessionsX')).toBeNull();
  });
});
