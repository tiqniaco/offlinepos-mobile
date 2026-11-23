import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { addSmsCodeListener, isSmsConsentAvailable, startSmsConsent, stopSmsConsent } from '../../../modules/sms-consent';

/** Android build with the SMS User Consent module (not iOS/web/Expo Go). */
const isSupported = () => Platform.OS === 'android' && isSmsConsentAvailable;

// Missing/old Google Play services, no activity…: the user simply types the code.
const start = () => {
  startSmsConsent().catch(() => {});
};

/**
 * Reads the OTP from the SMS on Android (Google SMS User Consent: a system sheet asks the user to allow reading
 * that one message — no SMS permission). While mounted, `onCode` receives every code the user allowed (always the
 * latest callback, so it sees current state). While `enabled`, a 5-minute listening window is open; `restart()`
 * opens a fresh one (call it right before asking the server for a new code, e.g. "resend").
 */
export function useSmsOtp(onCode: (code: string) => void, enabled = true): { restart: () => void; supported: boolean } {
  const cb = useRef(onCode);
  useEffect(() => {
    cb.current = onCode;
  });

  const supported = isSupported();

  useEffect(() => {
    if (!supported) return;
    const sub = addSmsCodeListener(({ code }) => cb.current(code));
    return () => {
      sub.remove();
      stopSmsConsent(); // also ends a window opened by restart() while not enabled
    };
  }, [supported]);

  useEffect(() => {
    if (!supported || !enabled) return;
    start();
    return () => stopSmsConsent();
  }, [supported, enabled]);

  const restart = useCallback(() => {
    if (supported) start();
  }, [supported]);

  return { restart, supported: supported && enabled };
}
