import type { TFunction } from 'i18next';
import { ApiError } from '../api/client';
import { LicenceError } from '../domain/licence/guard';
import { PermissionError } from '../domain/auth/users';

/** Turns any error into a clear Arabic (or English) sentence for the user. */
export function errorMessage(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const msg = t(key);
    return msg === key ? t('errors.unknown') : msg;
  }
  if (e instanceof LicenceError) return e.reason === 'limit' ? t('licence.limit') : t(`licence.reason.${e.reason}`, { defaultValue: t('licence.readOnly') });
  if (e instanceof PermissionError) return t('users.noPermission');
  return t('errors.unknown');
}
