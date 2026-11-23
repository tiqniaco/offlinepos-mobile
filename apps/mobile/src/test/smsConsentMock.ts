// Jest stand-in for the local native module modules/sms-consent (no native code under Jest).
export const isSmsConsentAvailable = false;
export const startSmsConsent = jest.fn(async () => {});
export const stopSmsConsent = jest.fn();
export const addSmsCodeListener = jest.fn(() => ({ remove: jest.fn() }));
