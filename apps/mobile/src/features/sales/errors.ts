import type { TFunction } from 'i18next';
import { PaymentError, PricingError } from '@daftarak/shared';
import { SalesError } from '../../domain/sales/sales';
import { invErrorMessage } from '../inventory/errors';

export function salesErrorMessage(t: TFunction, e: unknown): string {
  if (e instanceof SalesError || e instanceof PaymentError) return t(`salesErrors.${e.code}`, { defaultValue: t('errors.unknown') });
  if (e instanceof PricingError) return t('invErrors.invalid_price');
  return invErrorMessage(t, e);
}
