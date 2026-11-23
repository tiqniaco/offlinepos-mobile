import { Platform } from 'react-native';
import { requireOptionalNativeModule, type EventSubscription, type NativeModule } from 'expo';

export type SmsCodeEvent = { code: string };
type SmsConsentEvents = { onCode: (event: SmsCodeEvent) => void };

type SmsConsentNative = NativeModule<SmsConsentEvents> & {
  start(): Promise<void>;
  stop(): void;
};

// Android only (Google SMS User Consent API). iOS autofills the code from the keyboard
// (textContentType="oneTimeCode"); web has nothing — both get these no-op stubs.
const native: SmsConsentNative | null = Platform.OS === 'android' ? requireOptionalNativeModule<SmsConsentNative>('SmsConsent') : null;

/** True when the native module is in this build (Android development/store builds, not Expo Go). */
export const isSmsConsentAvailable = native != null;

/**
 * Listen for the next SMS that contains a code for 5 minutes. Android shows a system sheet; on "Allow" the
 * first 6-digit code arrives through `addSmsCodeListener`. Calling again restarts the 5-minute window.
 * Rejects when Google Play services is missing or too old.
 */
export async function startSmsConsent(): Promise<void> {
  if (native) await native.start();
}

export function stopSmsConsent(): void {
  native?.stop();
}

export function addSmsCodeListener(listener: (event: SmsCodeEvent) => void): EventSubscription {
  if (!native) return { remove() {} };
  return native.addListener('onCode', listener);
}
