import { eq } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import { kvMeta } from '../db/schema';

export interface CurrentDevice {
  id: string;
  code: string;
}

export async function getMeta(db: Pick<AppDb, 'select'>, key: string): Promise<string | null> {
  const r = await db.select().from(kvMeta).where(eq(kvMeta.key, key)).limit(1);
  return r[0]?.value ?? null;
}

export async function setMeta(db: Pick<AppDb, 'insert'>, key: string, value: string): Promise<void> {
  await db.insert(kvMeta).values({ key, value }).onConflictDoUpdate({ target: kvMeta.key, set: { value } });
}

export async function getCurrentDevice(db: AppDb): Promise<CurrentDevice | null> {
  const id = await getMeta(db, 'device_id');
  const code = await getMeta(db, 'device_code');
  return id && code ? { id, code } : null;
}
