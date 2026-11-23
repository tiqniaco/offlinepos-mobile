export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  // vars
  /** "production" on the deployed Worker (wrangler env.production). Test-only shortcuts are off there. */
  ENVIRONMENT?: string;
  OTP_PROVIDER: 'console' | 'smsmisr';
  /** Local E2E runs only (console provider). Ignored when ENVIRONMENT = production. */
  OTP_FIXED_CODE?: string;
  /** Global SMS cap per UTC day across all numbers (default 3000). */
  OTP_DAILY_CAP?: string;
  /** SMS cap per number range (first 6 digits) per hour (default 100). */
  OTP_PREFIX_HOURLY_CAP?: string;
  /** Global invoice-scan cap per UTC day across all businesses (default 2000) — spend circuit breaker. */
  OCR_DAILY_SCAN_CAP?: string;
  LICENCE_KID: string;
  ADMIN_ORIGIN: string;
  SMSMISR_BASE_URL: string;
  /** "1" = live, "2" = test (SMS Misr convention). */
  SMSMISR_ENVIRONMENT: string;
  // secrets
  LICENCE_SIGNING_KEY: string; // Ed25519 secret key, hex
  ACCESS_TOKEN_SECRET: string;
  OTP_PEPPER: string;
  BACKUP_WRAP_KEY: string; // 32 bytes, base64url
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  REVENUECAT_WEBHOOK_SECRET: string;
  /** "1" = apply RevenueCat SANDBOX events (test purchases). Off by default: sandbox events are recorded and ignored. */
  REVENUECAT_ALLOW_SANDBOX?: string;
  INTEGRITY_MODE?: 'off' | 'log' | 'enforce';
  ANDROID_PACKAGE?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  /** Optional: Expo push 'enhanced security' access token. */
  EXPO_ACCESS_TOKEN?: string;
  SMSMISR_USERNAME?: string;
  SMSMISR_PASSWORD?: string;
  SMSMISR_SENDER?: string;
  SMSMISR_TEMPLATE?: string;
  /** Claude API key for supplier-invoice scans (OCR). Without it /v1/purchases/scan answers 503 ocr_unavailable. */
  ANTHROPIC_API_KEY?: string;
  /** First (cheap) OCR model; default claude-haiku-5-5. */
  OCR_MODEL?: string;
  /** Retry model when the first read fails; default claude-opus-5-5. */
  OCR_FALLBACK_MODEL?: string;
  /** Normal SMS API endpoint (used when there is no OTP template). */
  SMSMISR_SMS_URL?: string;
}

export interface Vars {
  accountId: string;
  sessionId: string;
  adminId: string;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
