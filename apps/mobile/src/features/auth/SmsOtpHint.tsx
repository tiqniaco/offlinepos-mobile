import { useTranslation } from 'react-i18next';
import { Text, colors } from '../../ui';

/** Tiny note under the OTP boxes on Android builds that can read the code from the SMS. */
export function SmsOtpHint({ show }: { show: boolean }) {
  const { t } = useTranslation();
  if (!show) return null;
  return (
    <Text variant="caption" className="text-center" style={{ color: colors.ink.soft }}>
      {t('otp.smsHint')}
    </Text>
  );
}
