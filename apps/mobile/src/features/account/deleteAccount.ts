/**
 * «احذف حسابي» (App Store 5.1.1(v), Google Play): the server deletes the account and all its data, then this phone
 * forgets everything too — database, product photos, keys and sign-in — and starts again at the welcome screen.
 */
import { Directory, File, Paths } from "expo-file-system";
import { api } from "../../api/client";
import { closeDatabase, DB_NAME } from "../../db/client";
import { SECURE_KEYS, deleteSecret } from "../../lib/secure";
import { clearAccessToken } from "../../lib/session";

export async function deleteAccountEverywhere(token: string): Promise<void> {
  await api.deleteAccount(token);
  await wipeThisPhone();
}

/** Deleted for good (unlike "set aside" after a damaged file): the owner asked for the data to be erased. */
export async function wipeThisPhone(): Promise<void> {
  closeDatabase();
  const sqliteDir = new Directory(Paths.document, "SQLite");
  if (sqliteDir.exists) {
    for (const item of sqliteDir.list()) {
      if (item instanceof File && item.name.startsWith(DB_NAME)) item.delete();
    }
  }
  for (const d of [
    new Directory(Paths.document, "product-images"),
    new Directory(Paths.cache, "backups"),
  ]) {
    if (d.exists) d.delete();
  }
  for (const k of [
    SECURE_KEYS.refreshToken,
    SECURE_KEYS.backupKey,
    SECURE_KEYS.dbKey,
  ])
    await deleteSecret(k).catch(() => undefined);
  clearAccessToken();
}
