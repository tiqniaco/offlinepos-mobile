import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';
import { LicenceError, ProductLimitError } from '../domain/licence/guard';
import { PermissionError } from '../domain/auth/users';
import { PartyError } from '../domain/parties/parties';
import { ApprovalError } from '../domain/auth/approval';
import { useUpgrade } from '../state/upgrade';

/** Turns any error into a clear Arabic (or English) sentence for the user. */
export function errorMessage(t: TFunction, e: unknown): string {
  if (e instanceof ApiError && e.code === 'limit_reached') {
    // Per-shop usage limit (plan or super-admin): a clear sentence per limit, with the numbers.
    const d = e.details ?? {};
    return t(`limitReached.${d.key ?? 'other'}`, { limit: d.limit ?? 0, used: d.used ?? 0, defaultValue: t('limitReached.other', { limit: d.limit ?? 0, used: d.used ?? 0 }) });
  }
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const msg = t(key);
    return msg === key ? withCode(t, e.code) : msg;
  }
  // No sign-in on this phone any more (session ended): say so instead of "a problem happened".
  if (e instanceof Error && e.message === 'signed_out') return t('licence.signedOut');
  if (e instanceof ProductLimitError) {
    setTimeout(() => useUpgrade.getState().show('products'), 0);
    return e.fits > 0 ? t('quickAdd.limitSome', { fits: e.fits, n: e.wanted }) : t('quickAdd.limitNone', { n: e.wanted });
  }
  if (e instanceof LicenceError && (e.reason === 'limit' || e.reason === 'feature')) setTimeout(() => useUpgrade.getState().show(e.reason === 'feature' ? 'feature' : String(e.limit ?? 'limit')), 0);
  if (e instanceof LicenceError) return e.reason === 'limit' ? t('licence.limit') : e.reason === 'feature' ? t('licence.feature') : t(`licence.reason.${e.reason}`, { defaultValue: t('licence.readOnly') });
  if (e instanceof PermissionError) return t('users.noPermission');
  if (e instanceof ApprovalError) return t(`approve.errors.${e.code}`);
  if (e instanceof PartyError) return t(`parties.errors.${e.code}`);
  return withCode(t, e instanceof Error ? e.name === 'Error' ? e.message : e.name : String(e));
}

/** "حصلت مشكلة" + a short technical code, so a screenshot tells us what went wrong. */
export function withCode(t: TFunction, code: string | null | undefined): string {
  const c = (code ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return c ? `${t('errors.unknown')} (${c})` : t('errors.unknown');
}
