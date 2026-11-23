export interface Env {
  DB: D1Database;
  BACKUPS: R2Bucket;
  R2_ACCOUNT_ID: string;
  R2_BUCKET: string;
  // vars
  OTP_PROVIDER: 'console' | 'smsmisr';
  /** Local E2E runs only (console provider). */
  OTP_FIXED_CODE?: string;
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
  INTEGRITY_MODE?: 'off' | 'log' | 'enforce';
  ANDROID_PACKAGE?: string;
  GOOGLE_SERVICE_ACCOUNT_JSON?: string;
  SMSMISR_USERNAME?: string;
  SMSMISR_PASSWORD?: string;
  SMSMISR_SENDER?: string;
  SMSMISR_TEMPLATE?: string;
}

export interface Vars {
  accountId: string;
  sessionId: string;
  adminId: string;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
