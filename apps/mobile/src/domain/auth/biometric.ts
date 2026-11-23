/** Turn fingerprint / face unlock on or off for a user (the OS prompt is shown by the caller). */
import type { Db as AppDb } from '../../db/types';
import { getCurrentDevice } from '../device';
import { updateUser, type SessionUser } from './users';

export async function setBiometric(db: AppDb, user: SessionUser, on: boolean) {
  const device = await getCurrentDevice(db);
  if (!device) throw new Error('no device');
  await updateUser(db, user, user.id, { biometricEnabled: on }, device);
}
