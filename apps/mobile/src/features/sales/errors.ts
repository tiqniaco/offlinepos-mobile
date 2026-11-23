import type { TFunction } from 'i18next';
import { PaymentError, PricingError } from '@daftarak/shared';
import { SalesError } from '../../domain/sales/sales';
import { invErrorMessage } from '../inventory/errors';
import { ShiftError } from '../../domain/shifts/shifts';

export function salesErrorMessage(t: TFunction, e: unknown): string {
  if (e instanceof SalesError || e instanceof PaymentError) return t(`salesErrors.${e.code}`, { defaultValue: t('errors.unknown') });
  if (e instanceof PricingError) return e.code === 'discount_too_large' || e.code === 'bad_discount' ? t('salesErrors.discount_too_large') : t('invErrors.invalid_price');
  if (e instanceof ShiftError) return t(`shift.errors.${e.code}`);
  return invErrorMessage(t, e);
}
