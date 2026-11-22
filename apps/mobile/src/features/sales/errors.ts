import type { TFunction } from 'i18next';
import { PaymentError, PricingError } from '@daftarak/shared';
import { SalesError } from '../../domain/sales/sales';
import { invErrorMessage } from '../inventory/errors';
import { ShiftError } from '../../domain/shifts/shifts';

export function salesErrorMessage(t: TFunction, e: unknown): string {
  if (e instanceof SalesError || e instanceof PaymentError) return t(`salesErrors.${e.code}`, { defaultValue: t('errors.unknown') });
  if (e instanceof PricingError) return t('invErrors.invalid_price');
  if (e instanceof ShiftError) return t(`shift.errors.${e.code}`);
  return invErrorMessage(t, e);
}
