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
    return t(`errors.limitReached.${d.key ?? 'other'}`, { limit: d.limit ?? 0, used: d.used ?? 0, defaultValue: t('errors.limitReached.other') });
  }
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const msg = t(key);
    return msg === key ? t('errors.unknown') : msg;
  }
  if (e instanceof ProductLimitError) {
    setTimeout(() => useUpgrade.getState().show('products'), 0);
    return e.fits > 0 ? t('quickAdd.limitSome', { fits: e.fits, n: e.wanted }) : t('quickAdd.limitNone', { n: e.wanted });
  }
  if (e instanceof LicenceError && (e.reason === 'limit' || e.reason === 'feature')) setTimeout(() => useUpgrade.getState().show(e.reason === 'feature' ? 'feature' : String(e.limit ?? 'limit')), 0);
  if (e instanceof LicenceError) return e.reason === 'limit' ? t('licence.limit') : e.reason === 'feature' ? t('licence.feature') : t(`licence.reason.${e.reason}`, { defaultValue: t('licence.readOnly') });
  if (e instanceof PermissionError) return t('users.noPermission');
  if (e instanceof ApprovalError) return t(`approve.errors.${e.code}`);
  if (e instanceof PartyError) return t(`parties.errors.${e.code}`);
  return t('errors.unknown');
}
