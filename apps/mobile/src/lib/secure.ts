/**
 * Secrets in the OS keystore (Android Keystore / iOS Keychain) via expo-secure-store.
 * AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: readable by background tasks after the phone was unlocked once
 * since boot, never synced to other devices or cloud backups (PLAN.md §3.1).
 */
import * as SecureStore from 'expo-secure-store';
import { base64urlEncode, bytesToHex } from '@daftarak/shared';

const OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const SECURE_KEYS = {
  dbKey: 'db_key_v1',
  backupKey: 'backup_key_v1',
  refreshToken: 'refresh_token_v1',
  installId: 'install_id_v1',
  maxSeenTime: 'max_seen_time_v1',
} as const;

function random(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export async function getSecret(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key, OPTS);
}

export async function setSecret(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTS);
}

export async function deleteSecret(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTS);
}

async function getOrCreate(key: string, make: () => string): Promise<string> {
  const existing = await getSecret(key);
  if (existing) return existing;
  const v = make();
  await setSecret(key, v);
  return v;
}

/** 256-bit SQLCipher key, hex. Created once per install. */
export const getOrCreateDbKey = () => getOrCreate(SECURE_KEYS.dbKey, () => bytesToHex(random(32)));
/** 256-bit backup key, base64url (PLAN.md D-15). Uploaded wrapped to the server at business creation. */
export const getOrCreateBackupKey = () => getOrCreate(SECURE_KEYS.backupKey, () => base64urlEncode(random(32)));
/** Random per-install id (not a hardware id). */
export const getOrCreateInstallId = () => getOrCreate(SECURE_KEYS.installId, () => base64urlEncode(random(16)));
